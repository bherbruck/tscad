/**
 * 3D path helpers for `<sweep path={...}>`. Each returns IR curves (end to end).
 */
import type { Curve } from "../ir";
import { DEG, dot, normalize, snap, snap3, type Vec3 } from "./math";

/** A 3D path: IR curves, end to end. */
export type Path3 = Curve[];

/** Options for {@link helix}. */
export interface HelixOptions {
  /** Radius of the helix, mm (distance from the Z axis to the path). */
  radius: number;
  /** Rise per full turn, mm. */
  pitch: number;
  /** Number of turns (may be fractional). Give this or `height`. */
  turns?: number;
  /** Total rise, mm (`turns = height / pitch`). */
  height?: number;
  /** Wind clockwise seen from above (a left-hand thread). Default false. */
  leftHanded?: boolean;
  /** Cubic pieces per turn; more is more accurate (default 8, a radial error of about 4e-6·radius). */
  segmentsPerTurn?: number;
  /** Z of the start, mm. Default 0. */
  z?: number;
}

/**
 * A helix about +Z starting at `(radius, 0, z)`, as one C¹ cubic NURBS (Hermite pieces of at
 * most 45°): the path for threads and springs.
 *
 * @example <sweep path={helix({ radius: 10, pitch: 2, turns: 5 })}><circle r={0.8} /></sweep>
 */
export function helix(o: HelixOptions): Path3 {
  const { radius: r, pitch } = o;
  const turns = o.turns ?? (o.height !== undefined ? o.height / pitch : NaN);
  if (!(r > 0)) throw new RangeError(`helix: radius must be > 0 (got ${r})`);
  if (!(pitch !== 0 && Number.isFinite(pitch))) throw new RangeError(`helix: pitch must be non-zero (got ${pitch})`);
  if (!(turns > 0)) throw new RangeError("helix: give turns > 0 or height > 0");
  const per = Math.max(4, Math.round(o.segmentsPerTurn ?? 8));
  const n = Math.max(1, Math.ceil(turns * per - 1e-9));
  const total = turns * 2 * Math.PI;
  const h = total / n;
  const s = o.leftHanded ? -1 : 1;
  const z0 = o.z ?? 0;
  const P = (t: number): Vec3 => [snap(r * Math.cos(t)), snap(s * r * Math.sin(t)), z0 + (pitch * t) / (2 * Math.PI)];
  // handles: the best cubic fit of a circular arc in XY ((4/3)·tan(h/4)), linear rise in Z
  const k = (4 / 3) * Math.tan(h / 4) * (3 / h);
  const D = (t: number): Vec3 => [-r * Math.sin(t) * k, s * r * Math.cos(t) * k, pitch / (2 * Math.PI)];
  const pts: [number, number, number, number][] = [];
  const knots: number[] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = i * h, b = (i + 1) * h;
    const pa = P(a), pb = P(b), da = D(a), db = D(b);
    if (i === 0) pts.push([...pa, 1]);
    pts.push([pa[0] + (da[0] * h) / 3, pa[1] + (da[1] * h) / 3, pa[2] + (da[2] * h) / 3, 1]);
    pts.push([pb[0] - (db[0] * h) / 3, pb[1] - (db[1] * h) / 3, pb[2] - (db[2] * h) / 3, 1]);
    pts.push([...pb, 1]);
    const k = (i + 1) / n;
    knots.push(...(i === n - 1 ? [1, 1, 1, 1] : [k, k, k]));
  }
  return [{ type: "nurbs", degree: 3, points: pts, knots }];
}

/** Straight lines through `points` (closed back to the first when `closed`). */
export function polyline3(points: readonly Vec3[], closed = false): Path3 {
  if (points.length < 2) throw new RangeError("polyline3 needs at least 2 points");
  const pts = closed ? [...points, points[0]!] : points;
  const out: Curve[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push({ type: "line", start: [...pts[i]!], end: [...pts[i + 1]!] });
  return out;
}

/** One straight segment. */
export function line3(start: Vec3, end: Vec3): Path3 {
  return [{ type: "line", start: [...start], end: [...end] }];
}

/** Options for {@link arc3}: a circular arc in 3D. */
export interface Arc3Options {
  /** Centre, default origin. */
  center?: Vec3;
  radius: number;
  /** Start angle, degrees (default 0, along `reference`). */
  start?: number;
  /** End angle, degrees (CCW about `axis`); `end - start` in (0, 360]. Default 360. */
  end?: number;
  /** Axis the arc turns about (right-hand rule). Default +Z. */
  axis?: Vec3;
  /** Direction of angle 0, square to `axis`. Default: +X (or +Y if the axis is along X). */
  reference?: Vec3;
}

/** A circular arc in 3D. */
export function arc3(o: Arc3Options): Path3 {
  const axis = normalize(o.axis ?? [0, 0, 1]);
  let ref: Vec3 = o.reference ? normalize(o.reference) : Math.abs(axis[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const d = dot(ref, axis);
  ref = snap3(normalize([ref[0] - d * axis[0], ref[1] - d * axis[1], ref[2] - d * axis[2]]));
  const start = (o.start ?? 0) * DEG;
  const end = (o.end ?? 360) * DEG;
  if (!(o.radius > 0)) throw new RangeError("arc3: radius must be > 0");
  if (!(end > start)) throw new RangeError("arc3: end must be greater than start");
  return [{ type: "arc", center: [...(o.center ?? [0, 0, 0])] as Vec3, axis: snap3(axis), reference: ref, radius: o.radius, start, end }];
}

/** A Bézier curve (degree = points − 1) through its control points. */
export function bezier3(points: readonly Vec3[]): Path3 {
  const n = points.length - 1;
  if (n < 1) throw new RangeError("bezier3 needs at least 2 points");
  return [{ type: "nurbs", degree: n, points: points.map((p) => [p[0], p[1], p[2], 1] as [number, number, number, number]), knots: [...Array(n + 1).fill(0), ...Array(n + 1).fill(1)] }];
}

/** Join several paths end to end. */
export function path3(...parts: Path3[]): Path3 {
  return parts.flat();
}
