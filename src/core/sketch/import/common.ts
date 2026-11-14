/**
 * Shared pieces of the 2D importers: errors, arc → rational NURBS (for non-similarity
 * transforms), affine transforms of segments, chaining loose segments into closed loops.
 */
import type { Vec2 } from "../../math";
import { arc, arcPoint, end, line, reverseSeg, start, TAU, type Affine2, type Arc2, type Loop2, type Nurbs2, type Seg2 } from "../seg";

export class ImportError extends Error {}

export interface ImportResult {
  loops: Loop2[];
  warnings: string[];
}

/** A circular arc as exact rational quadratic NURBS pieces (≤ 90° each). */
export function arcToNurbs(s: Arc2): Nurbs2 {
  const sweep = s.a1 - s.a0;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / n, w = Math.cos(step / 2);
  const pts: [number, number, number][] = [];
  const knots: number[] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = s.a0 + step * i, b = a + step, m = (a + b) / 2;
    const P0 = i === 0 ? arcPoint(s, a) : undefined;
    if (P0) pts.push([P0[0], P0[1], 1]);
    pts.push([s.c[0] + (s.r * Math.cos(m)) / w, s.c[1] + (s.r * Math.sin(m)) / w, w]);
    const P2 = arcPoint(s, b);
    pts.push([P2[0], P2[1], 1]);
    if (i < n - 1) knots.push((i + 1) / n, (i + 1) / n);
  }
  knots.push(1, 1, 1);
  return { kind: "nurbs", degree: 2, pts, knots };
}

export const apply = (m: Affine2, p: Vec2): Vec2 => [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];

/** Is `m` a similarity (rotation/reflection + uniform scale + translation)? */
export function isSimilarity(m: Affine2): boolean {
  const c1 = Math.hypot(m[0], m[2]), c2 = Math.hypot(m[1], m[3]);
  const dot = m[0] * m[1] + m[2] * m[3];
  return Math.abs(c1 - c2) <= 1e-12 * Math.max(c1, c2) && Math.abs(dot) <= 1e-12 * c1 * c2;
}

/** Any affine transform of a segment: arcs stay arcs under similarities, else become NURBS. */
export function transformSegAffine(s: Seg2, m: Affine2): Seg2 {
  switch (s.kind) {
    case "line":
      return line(apply(m, s.a), apply(m, s.b));
    case "nurbs":
      return { ...s, pts: s.pts.map(([x, y, w]) => [...apply(m, [x, y]), w] as [number, number, number]) };
    case "arc": {
      if (!isSimilarity(m)) return transformSegAffine(arcToNurbs(s), m);
      const det = m[0] * m[3] - m[1] * m[2];
      const k = Math.sqrt(Math.abs(det));
      const theta = Math.atan2(m[2], m[0]);
      const c = apply(m, s.c);
      return det > 0 ? arc(c, s.r * k, s.a0 + theta, s.a1 + theta) : arc(c, s.r * k, theta - s.a0, theta - s.a1);
    }
  }
}

export function mulAffine(a: Affine2, b: Affine2): Affine2 {
  // a · b (b first)
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[0] * b[4] + a[1] * b[5] + a[4],
    a[2] * b[4] + a[3] * b[5] + a[5],
  ];
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Make a segment start exactly at `p` (lines and NURBS move an end; arcs can't). */
function snapStart(s: Seg2, p: Vec2): Seg2 | undefined {
  if (s.kind === "line") return line(p, s.b);
  if (s.kind === "nurbs") {
    const pts = s.pts.map((q) => [...q] as [number, number, number]);
    pts[0] = [p[0], p[1], pts[0]![2]];
    return { ...s, pts };
  }
  return undefined;
}

/**
 * Chain loose segments into closed loops: ends within `tol` join (snapped exactly; a tiny
 * bridging line between two arcs). Chains that don't close are reported by their `labels`.
 */
export function chainLoops(segs: { seg: Seg2; label: string }[], tol: number, warnings: string[]): Loop2[] {
  const loops: Loop2[] = [];
  const used = new Array(segs.length).fill(false);
  // endpoint grid for near-neighbour lookup
  const cell = Math.max(tol * 4, 1e-9);
  const grid = new Map<string, number[]>();
  const key = (p: Vec2) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
  segs.forEach((s, i) => {
    for (const p of [start(s.seg), end(s.seg)]) grid.set(key(p), [...(grid.get(key(p)) ?? []), i]);
  });
  const near = (p: Vec2): number[] => {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(...(grid.get(`${cx + dx},${cy + dy}`) ?? []));
    return out;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain: Seg2[] = [segs[i]!.seg];
    const labels = [segs[i]!.label];
    const first = start(segs[i]!.seg);
    for (;;) {
      const tail = end(chain[chain.length - 1]!);
      if (chain.length > 1 && dist(tail, first) <= tol) break;
      if (chain.length === 1 && dist(tail, first) <= tol && dist(tail, first) > 0) break;
      let best = -1, flip = false, bd = Infinity;
      for (const j of near(tail)) {
        if (used[j]) continue;
        const ds = dist(start(segs[j]!.seg), tail), de = dist(end(segs[j]!.seg), tail);
        if (ds <= tol && ds < bd) [best, flip, bd] = [j, false, ds];
        if (de <= tol && de < bd) [best, flip, bd] = [j, true, de];
      }
      if (best < 0) break;
      used[best] = true;
      labels.push(segs[best]!.label);
      chain.push(flip ? reverseSeg(segs[best]!.seg) : segs[best]!.seg);
    }
    const gap = dist(end(chain[chain.length - 1]!), first);
    if (gap > tol) {
      warnings.push(`open chain of ${chain.length} entit${chain.length === 1 ? "y" : "ies"} (${labels.slice(0, 6).join(", ")}${labels.length > 6 ? ", ..." : ""}): its ends are ${gap.toPrecision(3)} mm apart; left out`);
      continue;
    }
    loops.push(weld(chain));
  }
  return loops;
}

/** Make consecutive segments meet exactly (snap, or bridge two arcs with a tiny line). */
export function weld(chain: Seg2[]): Loop2 {
  const out: Seg2[] = [];
  for (let k = 0; k < chain.length; k++) {
    const s = chain[k]!;
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(s);
      continue;
    }
    const p = end(prev);
    if (dist(start(s), p) === 0) out.push(s);
    else {
      const snapped = snapStart(s, p);
      if (snapped) out.push(snapped);
      else if (prev.kind === "line") {
        out[out.length - 1] = line(prev.a, start(s));
        out.push(s);
      } else {
        out.push(line(p, start(s)));
        out.push(s);
      }
    }
  }
  // close
  const f = out[0]!, l = out[out.length - 1]!;
  const gap = dist(end(l), start(f));
  if (gap > 0 && out.length > 1) {
    if (l.kind === "line") out[out.length - 1] = line(l.a, start(f));
    else if (f.kind === "line") out[0] = line(end(l), f.b);
    else if (l.kind === "nurbs") {
      const pts = l.pts.map((q) => [...q] as [number, number, number]);
      const s0 = start(f);
      pts[pts.length - 1] = [s0[0], s0[1], pts[pts.length - 1]![2]];
      out[out.length - 1] = { ...l, pts };
    } else out.push(line(end(l), start(f)));
  }
  return out;
}

/**
 * Drop slivers that break solids: lines shorter than `tol` go, and arcs are turned (about their
 * own centre) to meet their neighbours exactly. A near-full arc closed by a tiny line (the usual
 * SVG way to draw a circle) becomes a full circle.
 */
export function cleanTiny(loop: Loop2, tol: number): Loop2 {
  let segs = loop.filter((s) => !(s.kind === "line" && dist(s.a, s.b) < tol));
  if (!segs.length) return loop;
  if (segs.length === 1 && segs[0]!.kind === "arc") {
    const a = segs[0]!;
    if (dist(start(a), end(a)) < tol * 10) return [arc(a.c, a.r, a.a0, a.a0 + (a.a1 > a.a0 ? TAU : -TAU))];
  }
  segs = segs.map((x) => ({ ...x })) as Seg2[];
  const angleNear = (c: Vec2, p: Vec2, near: number) => {
    let t = Math.atan2(p[1] - c[1], p[0] - c[0]);
    while (t - near > Math.PI) t -= TAU;
    while (near - t > Math.PI) t += TAU;
    return t;
  };
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i]!, b = segs[(i + 1) % segs.length]!;
    const pa = end(a), pb = start(b);
    if (dist(pa, pb) === 0) continue;
    if (a.kind === "arc") a.a1 = angleNear(a.c, pb, a.a1);
    else if (b.kind === "arc") b.a0 = angleNear(b.c, pa, b.a0);
  }
  return weld(segs);
}

/** Bounding box of loops (sampled). */
export function bbox(loops: Loop2[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops)
    for (const s of l) {
      const pts: Vec2[] = s.kind === "arc" ? Array.from({ length: 33 }, (_, i) => arcPoint(s, s.a0 + ((s.a1 - s.a0) * i) / 32)) : s.kind === "line" ? [s.a, s.b] : s.pts.map((q) => [q[0], q[1]] as Vec2);
      for (const [x, y] of pts) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  return [x0, y0, x1, y1];
}

export { TAU };
