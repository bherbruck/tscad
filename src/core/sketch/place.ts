/**
 * Loops → IR curves on a 3D plane, and hole detection (even-odd nesting).
 */
import type { Curve } from "../../ir";
import { add, cross, normalize, scale3, snap, snap3, type Vec3 } from "../math";
import { inside, polyline, reverseLoop, signedArea, TAU, type Loop2, type Seg2 } from "./seg";

/** A sketch plane: origin and a right-handed frame (`u × v = n`). */
export interface Frame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

export function frame(origin: Vec3, u: Vec3, v: Vec3): Frame {
  return { origin, u, v, n: snap3(cross(u, v)) };
}

/** Named sketch planes (CadQuery convention). */
export const PLANES = {
  /** sketch x → +X, sketch y → +Y, normal +Z */
  XY: frame([0, 0, 0], [1, 0, 0], [0, 1, 0]),
  /** sketch x → +Y, sketch y → +Z, normal +X */
  YZ: frame([0, 0, 0], [0, 1, 0], [0, 0, 1]),
  /** sketch x → +X, sketch y → +Z, normal −Y */
  XZ: frame([0, 0, 0], [1, 0, 0], [0, 0, 1]),
} as const;
export type PlaneName = keyof typeof PLANES;

export function at(f: Frame, x: number, y: number): Vec3 {
  return snap3(add(f.origin, add(scale3(f.u, x), scale3(f.v, y))));
}

function normAngles(a: number, b: number): [number, number] {
  // a < b; shift so a ∈ [0, 2π)
  const k = Math.floor(a / TAU);
  let s = a - k * TAU, e = b - k * TAU;
  if (Math.abs(s - TAU) < 1e-12) {
    s -= TAU;
    e -= TAU;
  }
  return [snapAngle(s), snapAngle(e)];
}
function snapAngle(t: number): number {
  const q = t / (Math.PI / 2);
  const r = Math.round(q);
  return Math.abs(q - r) < 1e-12 ? (r * Math.PI) / 2 : t;
}

/** One sketch segment as an IR curve on frame `f`. */
export function toCurve(s: Seg2, f: Frame): Curve {
  switch (s.kind) {
    case "line":
      return { type: "line", start: at(f, s.a[0], s.a[1]), end: at(f, s.b[0], s.b[1]) };
    case "arc": {
      const ccw = s.a1 > s.a0;
      const [start, end] = ccw ? normAngles(s.a0, s.a1) : normAngles(-s.a0, -s.a1);
      return {
        type: "arc",
        center: at(f, s.c[0], s.c[1]),
        axis: ccw ? f.n : (scale3(f.n, -1).map((x) => snap(x) + 0) as Vec3),
        reference: f.u,
        radius: s.r,
        start,
        end,
      };
    }
    case "nurbs":
      return {
        type: "nurbs",
        degree: s.degree,
        points: s.pts.map(([x, y, w]) => [...at(f, x, y), w] as [number, number, number, number]),
        knots: s.knots,
      };
  }
}

export function toCurves(loop: Loop2, f: Frame): Curve[] {
  return loop.map((s) => toCurve(s, f));
}

/** Make the loop counter-clockwise (positive area) in its sketch. */
export function ccw(loop: Loop2): Loop2 {
  return signedArea(polyline(loop)) < 0 ? reverseLoop(loop) : loop;
}

/** An outer loop and the holes directly inside it. */
export interface Region<T> {
  outer: T;
  holes: T[];
}

/**
 * Group loops by even-odd nesting: a loop inside an odd number of others is a hole of the
 * innermost loop containing it; one inside an even number (0, 2, ...) is an outer boundary.
 */
export function regions<T>(items: T[], loopOf: (t: T) => Loop2): Region<T>[] {
  const polys = items.map((t) => polyline(loopOf(t)));
  const probe = polys.map((p) => interiorPoint(p));
  const containers = items.map((_, i) => polys.map((_, j) => j).filter((j) => j !== i && inside(probe[i]!, polys[j]!) && Math.abs(signedArea(polys[j]!)) > Math.abs(signedArea(polys[i]!))));
  const depth = containers.map((c) => c.length);
  const out: Region<T>[] = [];
  const regionOf = new Map<number, Region<T>>();
  items.forEach((t, i) => {
    if (depth[i]! % 2 === 0) {
      const r: Region<T> = { outer: t, holes: [] };
      regionOf.set(i, r);
      out.push(r);
    }
  });
  items.forEach((t, i) => {
    if (depth[i]! % 2 === 1) {
      // the innermost container: the one with the greatest depth
      const parent = containers[i]!.reduce((best, j) => (best < 0 || depth[j]! > depth[best]! ? j : best), -1);
      regionOf.get(parent)?.holes.push(t);
    }
  });
  return out;
}

/** A point strictly inside the polygon, robust for concave shapes (scanline midpoint). */
function interiorPoint(poly: [number, number][]): [number, number] {
  // use a vertex nudged inward along the bisector; fallback: scanline through the centroid's y
  let ymin = Infinity, ymax = -Infinity;
  for (const [, y] of poly) {
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  for (const f of [0.5, 0.37, 0.61, 0.23, 0.77]) {
    const y = ymin + (ymax - ymin) * f;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if (a[1] > y !== b[1] > y) xs.push(((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]);
    }
    xs.sort((a, b) => a - b);
    let best: [number, number] | null = null, width = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1]! - xs[k]!;
      if (w > width) {
        width = w;
        best = [(xs[k]! + xs[k + 1]!) / 2, y];
      }
    }
    if (best) return best;
  }
  return poly[0] ?? [0, 0];
}

/** Start point and unit tangent of a 3D curve path. */
export function pathStart(c: Curve): { point: Vec3; tangent: Vec3 } {
  switch (c.type) {
    case "line":
      return { point: c.start, tangent: normalize([c.end[0] - c.start[0], c.end[1] - c.start[1], c.end[2] - c.start[2]]) };
    case "arc": {
      const w = cross(c.axis, c.reference);
      const cs = Math.cos(c.start), sn = Math.sin(c.start);
      const radial: Vec3 = [c.reference[0] * cs + w[0] * sn, c.reference[1] * cs + w[1] * sn, c.reference[2] * cs + w[2] * sn];
      return { point: add(c.center, scale3(radial, c.radius)), tangent: normalize(cross(c.axis, radial)) };
    }
    case "nurbs": {
      const p0 = c.points[0]!;
      const p1 = c.points.find((p) => Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]) > 1e-12) ?? p0;
      return { point: [p0[0], p0[1], p0[2]], tangent: normalize([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]) };
    }
  }
}

/** The plane square to `tangent` at `point`: sketch y = +Z projected (or +Y), x completes it. */
export function frameAcross(point: Vec3, tangent: Vec3): Frame {
  const t = normalize(tangent);
  const up: Vec3 = Math.abs(t[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  const d = up[0] * t[0] + up[1] * t[1] + up[2] * t[2];
  const v = normalize([up[0] - d * t[0], up[1] - d * t[1], up[2] - d * t[2]]);
  const u = normalize(cross(v, t));
  return { origin: point, u: snap3(u), v: snap3(v), n: snap3(t) };
}
