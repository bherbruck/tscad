/**
 * Exact 2D booleans of sketch regions: union, difference, intersection over loops of lines and
 * circular arcs (NURBS are flattened to lines first). Arcs stay arcs.
 *
 * Method (boundary evaluation):
 * 1. Each operand is a region: its loops oriented so its material is on their left (outer
 *    loops CCW, holes CW, by the usual even-odd nesting); its winding number is > 0 inside.
 * 2. Every segment is intersected with every other (line/line, line/arc, arc/arc exactly;
 *    collinear and co-circular overlaps add each other's end points). Intersection points are
 *    snapped to one canonical point within a tolerance, so touching vertices, tangencies and
 *    shared edges meet exactly.
 * 3. Segments are split at those points. Each piece is classified by probing just left and
 *    right of its midpoint with exact winding numbers (a ray cast against lines and arcs); a
 *    piece is part of the result's boundary when the operation's membership differs on its
 *    two sides, and is oriented with the result on its left. Coincident pieces keep one copy.
 * 4. Pieces are stitched into loops (taking the leftmost turn where loops touch at a vertex),
 *    and collinear lines / co-circular arcs are merged back.
 */
import type { Vec2 } from "../math";
import { regions } from "./place";
import { arc, arcPoint, line, nurbsPoint, polyline, reverseLoop, signedArea, TAU, type Arc2, type Line2, type Loop2, type Seg2 } from "./seg";

export type BooleanOp = "union" | "difference" | "intersection";

export class BooleanError extends Error {}

type S = Line2 | Arc2;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const crs = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);

// ---------------------------------------------------------------------------------------------
// segment parameterisation: lines t ∈ [0, 1]; arcs by angle from a0 to a1 (either direction)

function pointAt(s: S, t: number): Vec2 {
  return s.kind === "line" ? [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t] : arcPoint(s, t);
}
function tangentAt(s: S, t: number): Vec2 {
  if (s.kind === "line") return sub(s.b, s.a);
  const d = s.a1 > s.a0 ? 1 : -1;
  return [-Math.sin(t) * d, Math.cos(t) * d];
}
function startParam(s: S): number {
  return s.kind === "line" ? 0 : s.a0;
}
function endParam(s: S): number {
  return s.kind === "line" ? 1 : s.a1;
}
/** Position of `t` along the segment from 0 (start) to 1 (end). */
function frac(s: S, t: number): number {
  return s.kind === "line" ? t : (t - s.a0) / (s.a1 - s.a0);
}

/** The arc parameter for angle θ if it lies on the arc (within `tol` radians), else undefined. */
function arcParam(s: Arc2, theta: number, tol: number): number | undefined {
  const sweep = s.a1 - s.a0;
  const dir = sweep > 0 ? 1 : -1;
  let d = ((((theta - s.a0) * dir) % TAU) + TAU) % TAU;
  if (d > TAU - tol && Math.abs(sweep) < TAU - tol) d -= TAU; // just before the start
  if (d < -tol || d > Math.abs(sweep) + tol) return undefined;
  return s.a0 + dir * Math.min(Math.max(d, 0), Math.abs(sweep));
}

// ---------------------------------------------------------------------------------------------
// intersections

interface Hit {
  ta: number;
  tb: number;
  p: Vec2;
}

function intersect(a: S, b: S, tol: number): Hit[] {
  if (a.kind === "line" && b.kind === "line") return lineLine(a, b, tol);
  if (a.kind === "line" && b.kind === "arc") return lineArc(a, b, tol);
  if (a.kind === "arc" && b.kind === "line") return lineArc(b, a, tol).map((h) => ({ ta: h.tb, tb: h.ta, p: h.p }));
  return arcArc(a as Arc2, b as Arc2, tol);
}

function lineLine(a: Line2, b: Line2, tol: number): Hit[] {
  const r = sub(a.b, a.a), q = sub(b.b, b.a);
  const lr = len(r), lq = len(q);
  if (lr === 0 || lq === 0) return [];
  const den = crs(r, q);
  const w = sub(b.a, a.a);
  if (Math.abs(den) <= 1e-12 * lr * lq) {
    // parallel: collinear overlap → each takes the other's end points
    if (Math.abs(crs(r, w)) / lr > tol) return [];
    const out: Hit[] = [];
    for (const p of [b.a, b.b]) {
      const t = dot(sub(p, a.a), r) / (lr * lr);
      if (t >= -tol / lr && t <= 1 + tol / lr) out.push({ ta: clamp01(t), tb: p === b.a ? 0 : 1, p });
    }
    for (const p of [a.a, a.b]) {
      const u = dot(sub(p, b.a), q) / (lq * lq);
      if (u >= -tol / lq && u <= 1 + tol / lq) out.push({ ta: p === a.a ? 0 : 1, tb: clamp01(u), p });
    }
    return out;
  }
  const t = crs(w, q) / den, u = crs(w, r) / den;
  if (t < -tol / lr || t > 1 + tol / lr || u < -tol / lq || u > 1 + tol / lq) return [];
  return [{ ta: clamp01(t), tb: clamp01(u), p: pointAt(a, clamp01(t)) }];
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function lineArc(l: Line2, c: Arc2, tol: number): Hit[] {
  const d = sub(l.b, l.a);
  const L = len(d);
  if (L === 0) return [];
  const f = sub(l.a, c.c);
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - c.r * c.r;
  let disc = B * B - 4 * A * C;
  // tangency: the distance from the centre to the line is r within tol
  const dist = Math.abs(crs(d, f)) / L;
  const ts: number[] = [];
  if (Math.abs(dist - c.r) <= tol) ts.push(-B / (2 * A));
  else if (disc > 0) {
    disc = Math.sqrt(disc);
    ts.push((-B - disc) / (2 * A), (-B + disc) / (2 * A));
  }
  const out: Hit[] = [];
  for (const t of ts) {
    if (t < -tol / L || t > 1 + tol / L) continue;
    const p = pointAt(l, clamp01(t));
    const ang = arcParam(c, Math.atan2(p[1] - c.c[1], p[0] - c.c[0]), tol / c.r);
    if (ang !== undefined) out.push({ ta: clamp01(t), tb: ang, p });
  }
  return out;
}

function arcArc(a: Arc2, b: Arc2, tol: number): Hit[] {
  const dv = sub(b.c, a.c);
  const d = len(dv);
  if (d <= tol && Math.abs(a.r - b.r) <= tol) {
    // the same circle: overlapping arcs share each other's end points
    const out: Hit[] = [];
    for (const [t, isStart] of [[b.a0, true], [b.a1, false]] as const) {
      const ta = arcParam(a, t, tol / a.r);
      if (ta !== undefined) out.push({ ta, tb: isStart ? b.a0 : b.a1, p: arcPoint(b, t) });
    }
    for (const [t, isStart] of [[a.a0, true], [a.a1, false]] as const) {
      const tb = arcParam(b, t, tol / b.r);
      if (tb !== undefined) out.push({ ta: isStart ? a.a0 : a.a1, tb, p: arcPoint(a, t) });
    }
    return out;
  }
  if (d <= tol) return []; // concentric, different radii
  if (d > a.r + b.r + tol || d < Math.abs(a.r - b.r) - tol) return [];
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const h2 = a.r * a.r - x * x;
  const pts: Vec2[] = [];
  const m: Vec2 = [a.c[0] + (dv[0] * x) / d, a.c[1] + (dv[1] * x) / d];
  const tangent = Math.abs(d - (a.r + b.r)) <= tol || Math.abs(d - Math.abs(a.r - b.r)) <= tol;
  if (tangent || h2 <= 0) pts.push(m);
  else {
    const h = Math.sqrt(h2);
    const n: Vec2 = [-dv[1] / d, dv[0] / d];
    pts.push([m[0] + n[0] * h, m[1] + n[1] * h], [m[0] - n[0] * h, m[1] - n[1] * h]);
  }
  const out: Hit[] = [];
  for (const p of pts) {
    const ta = arcParam(a, Math.atan2(p[1] - a.c[1], p[0] - a.c[0]), tol / a.r);
    const tb = arcParam(b, Math.atan2(p[1] - b.c[1], p[0] - b.c[0]), tol / b.r);
    if (ta !== undefined && tb !== undefined) out.push({ ta, tb, p });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// canonical points

class Points {
  readonly pts: Vec2[] = [];
  readonly #grid = new Map<string, number[]>();
  constructor(readonly tol: number) {}
  #key(x: number, y: number) {
    const c = this.tol * 4;
    return `${Math.floor(x / c)},${Math.floor(y / c)}`;
  }
  id(p: Vec2): number {
    const c = this.tol * 4;
    const gx = Math.floor(p[0] / c), gy = Math.floor(p[1] / c);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const k of this.#grid.get(`${gx + i},${gy + j}`) ?? []) if (len(sub(this.pts[k]!, p)) <= this.tol) return k;
    const k = this.pts.length;
    this.pts.push(p);
    const key = this.#key(p[0], p[1]);
    (this.#grid.get(key) ?? this.#grid.set(key, []).get(key)!).push(k);
    return k;
  }
}

// ---------------------------------------------------------------------------------------------
// winding numbers (exact, against lines and arcs)

const RAY: Vec2 = [Math.cos(0.3711), Math.sin(0.3711)]; // an arbitrary, irrational-ish direction

function winding(p: Vec2, segs: readonly S[]): number {
  let w = 0;
  for (const s of segs) {
    if (s.kind === "line") {
      const r = sub(s.b, s.a);
      const den = crs(RAY, r);
      if (den === 0) continue;
      const q = sub(s.a, p);
      const t = crs(q, RAY) / den; // along the segment
      const u = crs(q, r) / den; // along the ray
      if (u > 0 && t >= 0 && t < 1) w += den > 0 ? 1 : -1;
    } else {
      const f = sub(p, s.c);
      const B = 2 * dot(f, RAY), C = dot(f, f) - s.r * s.r;
      const disc = B * B - 4 * C;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      for (const u of [(-B - sq) / 2, (-B + sq) / 2]) {
        if (u <= 0) continue;
        const q: Vec2 = [p[0] + RAY[0] * u, p[1] + RAY[1] * u];
        const th = Math.atan2(q[1] - s.c[1], q[0] - s.c[0]);
        if (onArcHalfOpen(s, th)) w += crs(RAY, tangentAt(s, th)) > 0 ? 1 : -1;
      }
    }
  }
  return w;
}

function onArcHalfOpen(s: Arc2, th: number): boolean {
  const sweep = s.a1 - s.a0;
  const dir = sweep > 0 ? 1 : -1;
  const d = ((((th - s.a0) * dir) % TAU) + TAU) % TAU;
  return d < Math.abs(sweep);
}

// ---------------------------------------------------------------------------------------------
// the boolean

/** Lines and arcs only: NURBS become polylines (chordal tolerance `tol`). */
function linesAndArcs(loop: Loop2, tol: number): S[] {
  const out: S[] = [];
  for (const s of loop) {
    if (s.kind !== "nurbs") {
      if (s.kind === "line" ? len(sub(s.b, s.a)) > 0 : s.a1 !== s.a0) out.push(s);
      continue;
    }
    const u0 = s.knots[0]!, u1 = s.knots[s.knots.length - 1]!;
    const n = Math.max(16, Math.min(512, Math.ceil(s.pts.length * 8 * Math.sqrt(1e-3 / Math.max(tol, 1e-9)))));
    let prev = nurbsPoint(s, u0);
    for (let i = 1; i <= n; i++) {
      const p = nurbsPoint(s, u0 + ((u1 - u0) * i) / n);
      if (len(sub(p, prev)) > 0) out.push(line(prev, p));
      prev = p;
    }
  }
  return out;
}

/**
 * An operand's loops oriented with its material on the left (outer CCW, holes CW). Overlapping
 * loops are unioned first (nested ones stay holes).
 */
function orient(loops: Loop2[]): Loop2[] {
  const out: Loop2[] = [];
  for (const r of regions(normalizeLoops(loops), (l) => l)) {
    out.push(signedArea(polyline(r.outer)) < 0 ? reverseLoop(r.outer) : r.outer);
    for (const h of r.holes) out.push(signedArea(polyline(h)) > 0 ? reverseLoop(h) : h);
  }
  return out;
}

interface Piece {
  seg: S;
  from: number;
  to: number;
}

/**
 * The boolean of operands (each a set of loops; nested loops are holes). `difference` keeps the
 * first operand minus all the others. Returns loops with the result on their left (outer loops
 * CCW, holes CW).
 */
export function booleanLoops(op: BooleanOp, operands: Loop2[][]): Loop2[] {
  const ops = operands.filter((o) => o.length);
  if (!ops.length) return [];
  if (op === "difference" && !operands[0]!.length) return [];
  if (op === "intersection" && ops.length < operands.length) return [];
  // size → tolerances
  let lo: Vec2 = [Infinity, Infinity], hi: Vec2 = [-Infinity, -Infinity];
  for (const o of ops)
    for (const l of o)
      for (const p of polyline(l)) {
        lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
        hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
      }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-9);
  const tol = size * 1e-9;
  const probe = size * 1e-7;

  const segsOf: S[][] = ops.map((o) => orient(o).flatMap((l) => linesAndArcs(l, size * 2e-4)));
  const all: { s: S; op: number }[] = segsOf.flatMap((segs, i) => segs.map((s) => ({ s, op: i })));
  const boxes = all.map(({ s }) => bbox(s, tol));

  // split parameters per segment
  const pts = new Points(tol);
  const splits: { t: number; id: number }[][] = all.map(({ s }) => [
    { t: startParam(s), id: pts.id(pointAt(s, startParam(s))) },
    { t: endParam(s), id: pts.id(pointAt(s, endParam(s))) },
  ]);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      if (!overlaps(boxes[i]!, boxes[j]!)) continue;
      for (const h of intersect(all[i]!.s, all[j]!.s, tol)) {
        const id = pts.id(h.p);
        splits[i]!.push({ t: h.ta, id });
        splits[j]!.push({ t: h.tb, id });
      }
    }

  // pieces
  const pieces: Piece[] = [];
  all.forEach(({ s }, i) => {
    const sp = splits[i]!.sort((a, b) => frac(s, a.t) - frac(s, b.t));
    for (let k = 0; k + 1 < sp.length; k++) {
      const a = sp[k]!, b = sp[k + 1]!;
      if (frac(s, b.t) - frac(s, a.t) <= 0) continue;
      // the same point at both ends: a whole circle (keep), or a sliver shorter than tol (drop)
      if (a.id === b.id && (s.kind === "line" || s.r * Math.abs(b.t - a.t) < tol * 10)) continue;
      const seg: S = s.kind === "line" ? line(pts.pts[a.id]!, pts.pts[b.id]!) : arc(s.c, s.r, a.t, b.t);
      pieces.push({ seg, from: a.id, to: b.id });
    }
  });

  // classify
  const inside = (w: number[]) =>
    op === "union" ? w.some((x) => x > 0) : op === "intersection" ? w.every((x) => x > 0) : w[0]! > 0 && w.slice(1).every((x) => x <= 0);
  const kept: Piece[] = [];
  const seen = new Set<string>();
  for (const pc of pieces) {
    const s = pc.seg;
    const tm = s.kind === "line" ? 0.5 : (s.a0 + s.a1) / 2;
    const m = pointAt(s, tm);
    const tg = tangentAt(s, tm);
    const tl = len(tg) || 1;
    const nl: Vec2 = [(-tg[1] / tl) * probe, (tg[0] / tl) * probe];
    const L = inside(segsOf.map((segs) => winding([m[0] + nl[0], m[1] + nl[1]], segs)));
    const R = inside(segsOf.map((segs) => winding([m[0] - nl[0], m[1] - nl[1]], segs)));
    if (L === R) continue;
    const piece: Piece = L ? pc : { seg: reverseS(s), from: pc.to, to: pc.from };
    // coincident pieces (shared edges): keep one
    const g = piece.seg;
    const q = (v: number) => Math.round(v / (tol * 100));
    const key = `${piece.from}>${piece.to}:${g.kind === "line" ? "l" : `a${q(g.c[0])},${q(g.c[1])},${q(g.r)},${q(pointAt(g, (g.a0 + g.a1) / 2)[0])},${q(pointAt(g, (g.a0 + g.a1) / 2)[1])}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(piece);
  }
  return merge(stitch(kept, pts), tol);
}

function reverseS(s: S): S {
  return s.kind === "line" ? line(s.b, s.a) : arc(s.c, s.r, s.a1, s.a0);
}

function bbox(s: S, pad: number): [number, number, number, number] {
  if (s.kind === "line") return [Math.min(s.a[0], s.b[0]) - pad, Math.min(s.a[1], s.b[1]) - pad, Math.max(s.a[0], s.b[0]) + pad, Math.max(s.a[1], s.b[1]) + pad];
  return [s.c[0] - s.r - pad, s.c[1] - s.r - pad, s.c[0] + s.r + pad, s.c[1] + s.r + pad];
}
function overlaps(a: number[], b: number[]): boolean {
  return a[0]! <= b[2]! && b[0]! <= a[2]! && a[1]! <= b[3]! && b[1]! <= a[3]!;
}

/** Chain pieces into loops, turning leftmost where loops touch at a vertex. */
function stitch(pieces: Piece[], pts: Points): S[][] {
  const out = new Map<number, number[]>();
  pieces.forEach((p, i) => (out.get(p.from) ?? out.set(p.from, []).get(p.from)!).push(i));
  const used = new Uint8Array(pieces.length);
  const loops: S[][] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (used[i]) continue;
    const loop: S[] = [];
    let cur = i;
    const startId = pieces[i]!.from;
    for (let guard = 0; guard <= pieces.length; guard++) {
      used[cur] = 1;
      const pc = pieces[cur]!;
      loop.push(pc.seg);
      if (pc.to === startId) break;
      const opts = (out.get(pc.to) ?? []).filter((k) => !used[k]);
      if (!opts.length) {
        loop.length = 0; // an open chain: shouldn't happen
        break;
      }
      const tin = tangentAt(pc.seg, endParam(pc.seg));
      // the leftmost turn: with the material on the left, this keeps regions that touch at a
      // single vertex as separate loops
      let best = opts[0]!, bestTurn = -Infinity;
      for (const k of opts) {
        const s = pieces[k]!.seg;
        const tout = tangentAt(s, startParam(s));
        const turn = Math.atan2(crs(tin, tout), dot(tin, tout));
        if (turn > bestTurn) {
          bestTurn = turn;
          best = k;
        }
      }
      cur = best;
    }
    if (loop.length) loops.push(loop);
  }
  void pts;
  return loops;
}

/** Merge collinear lines and co-circular arcs; drop loops with no area. */
function merge(loops: S[][], tol: number): Loop2[] {
  const out: Loop2[] = [];
  for (const loop of loops) {
    const m: S[] = [];
    for (const s of loop) {
      const prev = m[m.length - 1];
      const joined = prev && join(prev, s, tol);
      if (joined) m[m.length - 1] = joined;
      else m.push(s);
    }
    while (m.length > 1) {
      const j = join(m[m.length - 1]!, m[0]!, tol);
      if (!j) break;
      m[0] = j;
      m.pop();
    }
    const area = loopArea(m);
    if (Math.abs(area) > tol * tol * 100 && m.length) out.push(m as Seg2[]);
  }
  return out;
}

function join(a: S, b: S, tol: number): S | undefined {
  if (a.kind === "line" && b.kind === "line") {
    const r = sub(a.b, a.a), q = sub(b.b, b.a);
    if (Math.abs(crs(r, q)) <= tol * (len(r) + len(q)) && dot(r, q) > 0) return line(a.a, b.b);
    return undefined;
  }
  if (a.kind === "arc" && b.kind === "arc") {
    if (len(sub(a.c, b.c)) > tol || Math.abs(a.r - b.r) > tol) return undefined;
    const da = a.a1 > a.a0 ? 1 : -1, db = b.a1 > b.a0 ? 1 : -1;
    if (da !== db) return undefined;
    // b starts where a ends (modulo 2π)
    const k = Math.round((a.a1 - b.a0) / TAU);
    if (Math.abs(a.a1 - (b.a0 + k * TAU)) > 1e-9) return undefined;
    const end = b.a1 + k * TAU;
    if (Math.abs(end - a.a0) > TAU + 1e-9) return undefined;
    return arc(a.c, a.r, a.a0, end);
  }
  return undefined;
}

/** Exact signed area of a loop of lines and arcs. */
export function loopArea(loop: readonly Seg2[]): number {
  let a = 0;
  for (const s of loop) {
    if (s.kind === "line") a += (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2;
    else if (s.kind === "arc") {
      const p0 = arcPoint(s, s.a0), p1 = arcPoint(s, s.a1);
      a += (s.c[0] * (p1[1] - p0[1]) - s.c[1] * (p1[0] - p0[0]) + s.r * s.r * (s.a1 - s.a0)) / 2;
    } else a += signedArea(polyline([s]));
  }
  return a;
}

/** Is `p` inside the region of `loops` (oriented with material on the left)? (For tests.) */
export function insideLoops(p: Vec2, loops: Loop2[]): boolean {
  return winding(p, orient(loops).flatMap((l) => linesAndArcs(l, 1e-6))) > 0;
}

// ---------------------------------------------------------------------------------------------
// loop sets with overlaps: union semantics, nested loops are holes

/** Do any two of these loops cross or touch? (exact, on lines and arcs) */
export function loopsOverlap(loops: Loop2[]): boolean {
  return overlapPairs(loops).length > 0;
}

function overlapPairs(loops: Loop2[]): [number, number][] {
  if (loops.length < 2) return [];
  const segs = loops.map((l) => linesAndArcs(l, 1e-4));
  let size = 0;
  for (const l of loops) for (const p of polyline(l)) size = Math.max(size, Math.abs(p[0]), Math.abs(p[1]));
  const tol = Math.max(size, 1) * 1e-9;
  const boxes = segs.map((ss) => ss.map((s) => bbox(s, tol)));
  const loopBox = boxes.map((bs) => bs.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number]));
  const out: [number, number][] = [];
  for (let i = 0; i < loops.length; i++)
    for (let j = i + 1; j < loops.length; j++) {
      if (!overlaps(loopBox[i]!, loopBox[j]!)) continue;
      let hit = false;
      for (let a = 0; a < segs[i]!.length && !hit; a++)
        for (let b = 0; b < segs[j]!.length && !hit; b++)
          if (overlaps(boxes[i]![a]!, boxes[j]![b]!) && intersect(segs[i]![a]!, segs[j]![b]!, tol).length) hit = true;
      if (hit) out.push([i, j]);
    }
  return out;
}

/**
 * The region of a set of loops where overlapping loops **union** and fully nested loops are
 * holes (islands inside holes are solid again, and so on). Without any crossing loops the
 * loops are returned unchanged (the plain even-odd nesting already means this).
 *
 * Depth: a loop's depth is 1 + the deepest loop that fully contains it (contains its interior
 * and doesn't cross it). The region is L0 − (L1 − (L2 − …)), with Ld the union of depth-d loops.
 */
export function normalizeLoops(loops: Loop2[]): Loop2[] {
  const pairs = overlapPairs(loops);
  if (!pairs.length) return loops;
  const crossing = new Set(pairs.map(([i, j]) => `${i},${j}`));
  const crosses = (i: number, j: number) => crossing.has(i < j ? `${i},${j}` : `${j},${i}`);
  const polys = loops.map((l) => polyline(l));
  const areas = loops.map((l) => Math.abs(loopArea(l)));
  const probe = loops.map((l) => interior(l));
  // j fully contains i
  const contains = (j: number, i: number) => j !== i && !crosses(i, j) && areas[j]! > areas[i]! && insidePoly(probe[i]!, polys[j]!);
  const depth = new Array<number>(loops.length).fill(-1);
  const depthOf = (i: number, guard = 0): number => {
    if (depth[i]! >= 0) return depth[i]!;
    let d = 0;
    if (guard < loops.length) for (let j = 0; j < loops.length; j++) if (contains(j, i)) d = Math.max(d, depthOf(j, guard + 1) + 1);
    depth[i] = d;
    return d;
  };
  loops.forEach((_, i) => depthOf(i));
  const max = Math.max(...depth);
  const level = (d: number) => booleanLoops("union", loops.filter((_, i) => depth[i] === d).map((l) => [l]));
  let acc = level(max);
  for (let d = max - 1; d >= 0; d--) acc = booleanLoops("difference", [level(d), acc]);
  return acc;
}

/** A point inside a loop (by its own winding). */
function interior(l: Loop2): Vec2 {
  const poly = polyline(l);
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
    let best: Vec2 | undefined, w = 0;
    for (let k = 0; k + 1 < xs.length; k += 2)
      if (xs[k + 1]! - xs[k]! > w) {
        w = xs[k + 1]! - xs[k]!;
        best = [(xs[k]! + xs[k + 1]!) / 2, y];
      }
    if (best) return best;
  }
  return poly[0] ?? [0, 0];
}

function insidePoly(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
