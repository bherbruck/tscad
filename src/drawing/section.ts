/**
 * Plane sections of triangle meshes: slice a solid's mesh (e.g. from `kernel.meshAt`) into
 * closed polylines in the plane's 2D frame — "the outline of this part at z = 2".
 */
import type { MeshArrays } from "../kernel/index";
import type { Vec2, Vec3 } from "../core/math";
import { polylineLoops } from "./common";
import { toDXF, type DxfOptions } from "./dxf";
import { toSVG, type SvgOptions } from "./svg";

/** A cutting plane: a point on it and its normal. */
export interface SectionPlane {
  origin: Vec3;
  normal: Vec3;
}

/** The plane's 2D frame: `u` = sketch x, `v` = sketch y (for +Z: x and y). */
export function planeFrame(normal: Vec3): { u: Vec3; v: Vec3; n: Vec3 } {
  const n = norm(normal);
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const u = norm(cross(helper, n));
  const v = cross(n, u);
  return { u, v, n };
}

export interface SectionResult {
  /** Closed loops in the plane frame, mm. */
  loops: Vec2[][];
  /** Chains that didn't close (a mesh that isn't watertight). */
  open: Vec2[][];
}

/** Slice `mesh` with `plane`. Mesh vertices exactly on the plane are nudged to one side. */
export function section(mesh: Pick<MeshArrays, "positions" | "indices">, plane: SectionPlane): SectionResult {
  const { u, v, n } = planeFrame(plane.normal);
  const P = mesh.positions, I = mesh.indices;
  const o = plane.origin;
  const vertCount = P.length / 3;
  // signed distances; on-plane vertices count as slightly above (symbolic perturbation)
  let scale = 0;
  for (let i = 0; i < P.length; i++) scale = Math.max(scale, Math.abs(P[i]!));
  const eps = 1e-9 * Math.max(1, scale);
  const dist = new Float64Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    const d = (P[3 * i]! - o[0]) * n[0] + (P[3 * i + 1]! - o[1]) * n[1] + (P[3 * i + 2]! - o[2]) * n[2];
    dist[i] = Math.abs(d) < eps ? eps : d;
  }
  const key = (i: number) => `${P[3 * i]},${P[3 * i + 1]},${P[3 * i + 2]}`;
  // a crossing point per (position-keyed) edge, computed the same way from either triangle
  const pointOf = new Map<string, Vec2>();
  const cut = (a: number, b: number): string => {
    let ka = key(a), kb = key(b);
    if (ka > kb) {
      [a, b] = [b, a];
      [ka, kb] = [kb, ka];
    }
    const k = `${ka}|${kb}`;
    if (!pointOf.has(k)) {
      const t = dist[a]! / (dist[a]! - dist[b]!);
      const p: Vec3 = [0, 1, 2].map((c) => P[3 * a + c]! + (P[3 * b + c]! - P[3 * a + c]!) * t) as Vec3;
      const r: Vec3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
      pointOf.set(k, [dot(r, u), dot(r, v)]);
    }
    return k;
  };
  const next = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    (next.get(a) ?? next.set(a, []).get(a)!).push(b);
    (next.get(b) ?? next.set(b, []).get(b)!).push(a);
  };
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t]!, I[t + 1]!, I[t + 2]!];
    const pts: string[] = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!, b = tri[(e + 1) % 3]!;
      if (dist[a]! > 0 !== dist[b]! > 0) pts.push(cut(a, b));
    }
    if (pts.length === 2) link(pts[0]!, pts[1]!);
  }
  // chain
  const used = new Set<string>();
  const edgeKey = (a: string, b: string) => (a < b ? `${a}#${b}` : `${b}#${a}`);
  const loops: Vec2[][] = [], open: Vec2[][] = [];
  const walk = (startKey: string): { chain: string[]; closed: boolean } => {
    const chain = [startKey];
    let cur = startKey;
    for (;;) {
      const nb = (next.get(cur) ?? []).find((x) => !used.has(edgeKey(cur, x)));
      if (nb === undefined) return { chain, closed: false };
      used.add(edgeKey(cur, nb));
      if (nb === startKey) return { chain, closed: true };
      chain.push(nb);
      cur = nb;
    }
  };
  // open chains first start at their ends (degree 1)
  for (const [k, nbs] of next) if (nbs.length === 1 && nbs.some((x) => !used.has(edgeKey(k, x)))) open.push(walk(k).chain.map((x) => pointOf.get(x)!));
  for (const k of next.keys()) {
    if ((next.get(k) ?? []).every((x) => used.has(edgeKey(k, x)))) continue;
    const { chain, closed } = walk(k);
    (closed ? loops : open).push(chain.map((x) => pointOf.get(x)!));
  }
  return { loops: loops.map(clean).filter((l) => l.length >= 3), open };
}

/** Drop repeated and collinear points. */
function clean(p: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-9) out.push(q);
  }
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length]!, b = out[i]!, c = out[(i + 1) % out.length]!;
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cr) < 1e-9 * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]) ** 2)) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}

/** Section → SVG. */
export function sectionToSVG(mesh: Pick<MeshArrays, "positions" | "indices">, plane: SectionPlane, options?: SvgOptions): string {
  return toSVG({ name: "section", loops: polylineLoops(section(mesh, plane).loops) }, options);
}
/** Section → DXF (closed POLYLINEs with `entities: "polyline"`, else LINEs). */
export function sectionToDXF(mesh: Pick<MeshArrays, "positions" | "indices">, plane: SectionPlane, options?: DxfOptions): string {
  return toDXF({ name: "section", loops: polylineLoops(section(mesh, plane).loops) }, options);
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (!l) throw new RangeError("section plane normal must not be zero");
  return [a[0] / l, a[1] / l, a[2] / l];
}
