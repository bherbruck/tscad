/**
 * 2D offset of sketch loops (lines + arcs exact; NURBS are flattened to lines first).
 *
 * Each loop is oriented with its region's material on the left (outer loops CCW, holes CW),
 * every segment is moved `d` to its right (outward from the material), and the joints are
 * repaired: gaps at convex corners are filled with an arc about the original corner (`round`)
 * or mitred, overlaps at concave corners are trimmed at the offset curves' intersection.
 * Arcs whose offset radius collapses are dropped (the neighbours then meet at a corner);
 * loops that vanish (holes closing up, islands shrinking away) are removed. Offsets so large
 * that a loop would self-intersect throw {@link OffsetError}.
 */
import type { Vec2 } from "../math";
import { regions } from "./place";
import { arc, end, line, polyline, reverseLoop, sample, signedArea, start, TAU, type Arc2, type Line2, type Loop2, type Seg2 } from "./seg";

export class OffsetError extends Error {}

type S = Line2 | Arc2;

const EPS = 1e-9;
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const crs = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (a: Vec2): Vec2 => {
  const l = len(a);
  return l ? [a[0] / l, a[1] / l] : [0, 0];
};
const right = (t: Vec2): Vec2 => [t[1], -t[0]];

function tangentAt(s: S, atEnd: boolean): Vec2 {
  if (s.kind === "line") return unit(sub(s.b, s.a));
  const t = atEnd ? s.a1 : s.a0;
  const dir = s.a1 > s.a0 ? 1 : -1;
  return [-Math.sin(t) * dir, Math.cos(t) * dir];
}

/** NURBS → lines (sampled); lines and arcs as they are. */
function linesAndArcs(loop: Loop2): S[] {
  const out: S[] = [];
  for (const s of loop) {
    if (s.kind !== "nurbs") out.push(s);
    else {
      const p = sample(s, Math.max(64, s.pts.length * 12));
      for (let i = 0; i + 1 < p.length; i++) out.push(line(p[i]!, p[i + 1]!));
    }
  }
  return out;
}

function offsetSeg(s: S, d: number): S | null {
  if (s.kind === "line") {
    const n = mul(right(unit(sub(s.b, s.a))), d);
    return line(add(s.a, n), add(s.b, n));
  }
  // CCW arc: right side is outward (r + d); CW arc: right side is toward the centre
  const r = s.a1 > s.a0 ? s.r + d : s.r - d;
  if (r <= EPS * Math.max(1, s.r)) return null;
  return arc(s.c, r, s.a0, s.a1);
}

/** Intersections of two segments' full curves (line = infinite line, arc = full circle). */
function intersections(a: S, b: S): Vec2[] {
  if (a.kind === "line" && b.kind === "line") {
    const r = sub(a.b, a.a), q = sub(b.b, b.a);
    const den = crs(r, q);
    if (Math.abs(den) < EPS * len(r) * len(q)) return [];
    const t = crs(sub(b.a, a.a), q) / den;
    return [add(a.a, mul(r, t))];
  }
  if (a.kind === "arc" && b.kind === "line") return lineCircle(b, a);
  if (a.kind === "line" && b.kind === "arc") return lineCircle(a, b);
  return circleCircle(a as Arc2, b as Arc2);
}
function lineCircle(l: Line2, c: Arc2): Vec2[] {
  const dvec = unit(sub(l.b, l.a));
  const f = sub(l.a, c.c);
  const B = dot(f, dvec), C = dot(f, f) - c.r * c.r;
  const disc = B * B - C;
  if (disc < -EPS * c.r * c.r) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  return [add(l.a, mul(dvec, -B - sq)), add(l.a, mul(dvec, -B + sq))];
}
function circleCircle(a: Arc2, b: Arc2): Vec2[] {
  const dv = sub(b.c, a.c);
  const dd = len(dv);
  if (dd < EPS || dd > a.r + b.r + EPS || dd < Math.abs(a.r - b.r) - EPS) return [];
  const x = (dd * dd + a.r * a.r - b.r * b.r) / (2 * dd);
  const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const m = add(a.c, mul(dv, x / dd));
  const n = mul(right(unit(dv)), h);
  return [add(m, n), sub(m, n)];
}

/** Move the end (or start) of `s` to point `p` (on its curve). */
function setEnd(s: S, p: Vec2, atEnd: boolean): S {
  if (s.kind === "line") return atEnd ? line(s.a, p) : line(p, s.b);
  let t = Math.atan2(p[1] - s.c[1], p[0] - s.c[0]);
  // keep the arc's direction and choose the angle nearest the old one
  const old = atEnd ? s.a1 : s.a0;
  t += Math.round((old - t) / TAU) * TAU;
  return atEnd ? arc(s.c, s.r, s.a0, t) : arc(s.c, s.r, t, s.a1);
}

/** Offset one loop whose material is on its left. Returns null when it vanishes. */
export function offsetLoop(loop: Loop2, d: number, round: boolean): Loop2 | null {
  if (d === 0) return loop;
  const src = linesAndArcs(loop);
  const area0 = signedArea(polyline(src));
  // offset each segment; drop arcs that collapse (their neighbours will meet at a corner)
  const segs: { o: S; corner: Vec2; t0: Vec2; t1: Vec2 }[] = [];
  for (const s of src) {
    const o = offsetSeg(s, d);
    if (!o) continue;
    segs.push({ o, corner: end(s), t0: tangentAt(s, false), t1: tangentAt(s, true) });
  }
  if (segs.length === 0) return null;
  if (segs.length === 1 && segs[0]!.o.kind === "arc" && Math.abs(Math.abs(segs[0]!.o.a1 - segs[0]!.o.a0) - TAU) < 1e-9) return [segs[0]!.o];
  const out: S[] = [];
  const n = segs.length;
  const cur = segs.map((s) => s.o);
  const fills: (S[] | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = cur[i]!, B = cur[j]!;
    const pa = end(A), pb = start(B);
    if (len(sub(pa, pb)) < 1e-9 * Math.max(1, Math.abs(d))) continue; // tangent / already meeting
    const turn = crs(tangentAt(A, true), tangentAt(B, false));
    const gap = d > 0 ? turn > 0 : turn < 0; // offset outward at a convex corner, or inward at a concave one
    const corner = segs[i]!.corner;
    if (gap && len(sub(pa, corner)) > EPS && len(sub(pb, corner)) > EPS && Math.abs(len(sub(pa, corner)) - Math.abs(d)) < 1e-6 * Math.max(1, Math.abs(d)) && round) {
      const a0 = Math.atan2(pa[1] - corner[1], pa[0] - corner[0]);
      let sweep = Math.atan2(pb[1] - corner[1], pb[0] - corner[0]) - a0;
      while (sweep > Math.PI) sweep -= TAU;
      while (sweep < -Math.PI) sweep += TAU;
      fills[i] = [arc(corner, Math.abs(d), a0, a0 + sweep)];
      continue;
    }
    // mitre (gap, not round) or trim (overlap): meet at the curves' intersection nearest the corner
    const ref = gap ? corner : mul(add(pa, pb), 0.5);
    let pts = intersections(A, B);
    if (gap && !round && (A.kind === "arc" || B.kind === "arc")) {
      // mitre arcs along their end tangents
      const ta = tangentAt(A, true), tb = tangentAt(B, false);
      pts = intersections(line(pa, add(pa, ta)), line(pb, add(pb, tb)));
      const p = pts[0];
      if (p) fills[i] = [line(pa, p), line(p, pb)];
      else fills[i] = [line(pa, pb)];
      continue;
    }
    const p = pts.sort((x, y) => len(sub(x, ref)) - len(sub(y, ref)))[0];
    if (!p || len(sub(p, ref)) > 1e3 * Math.max(1, Math.abs(d))) {
      fills[i] = [line(pa, pb)]; // parallel / no meeting point: bridge
      continue;
    }
    cur[i] = setEnd(A, p, true);
    cur[j] = setEnd(cur[j]!, p, false);
  }
  // a segment whose offset ran backwards was overrun: the loop collapses (when it shrinks)
  // or folds over itself (when it grows)
  const shrinking = d < 0 === area0 > 0;
  for (let i = 0; i < n; i++) {
    const s = cur[i]!, o = segs[i]!;
    const reversed =
      s.kind === "line"
        ? dot(sub(s.b, s.a), o.t0) < -1e-12
        : o.o.kind === "arc" && Math.sign(s.a1 - s.a0) !== Math.sign(o.o.a1 - o.o.a0) && Math.abs(s.a1 - s.a0) > 1e-12;
    if (reversed) {
      if (shrinking) return null;
      throw new OffsetError(`offsetting by ${d} makes a loop fold over itself (the distance is larger than a feature of the shape)`);
    }
  }
  for (let i = 0; i < n; i++) {
    const s = cur[i]!;
    if (s.kind === "line" ? len(sub(s.b, s.a)) > 1e-12 : Math.abs(s.a1 - s.a0) > 1e-12) out.push(s);
    for (const f of fills[i] ?? []) if (f.kind !== "line" || len(sub(f.b, f.a)) > 1e-12) out.push(f);
  }
  if (out.length === 0) return null;
  const poly = polyline(out);
  const area1 = signedArea(poly);
  // a loop that turned inside out (or collapsed) has vanished
  if (Math.sign(area1) !== Math.sign(area0) || Math.abs(area1) < 1e-12) return null;
  if (selfIntersects(poly)) throw new OffsetError(`offsetting by ${d} makes a loop cross itself (the distance is larger than a feature of the shape)`);
  return out;
}

function selfIntersects(p: Vec2[]): boolean {
  const n = p.length;
  if (n > 4000) return false;
  for (let i = 0; i < n; i++) {
    const a = p[i]!, b = p[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = p[j]!, e = p[(j + 1) % n]!;
      const d1 = crs(sub(b, a), sub(c, a)), d2 = crs(sub(b, a), sub(e, a));
      const d3 = crs(sub(e, c), sub(a, c)), d4 = crs(sub(e, c), sub(b, c));
      if (d1 * d2 < -1e-12 && d3 * d4 < -1e-12) return true;
    }
  }
  return false;
}

/**
 * Offset a set of loops (nested loops are holes, even-odd) by `d`: positive grows the material,
 * negative shrinks it. Throws {@link OffsetError} when an outer boundary would self-intersect.
 */
export function offsetLoops(loops: Loop2[], d: number, round = true): Loop2[] {
  if (d === 0) return loops;
  const out: Loop2[] = [];
  for (const r of regions(loops, (l) => l)) {
    const outer = signedArea(polyline(r.outer)) < 0 ? reverseLoop(r.outer) : r.outer;
    const o = offsetLoop(outer, d, round);
    if (o) out.push(o);
    else if (d > 0) throw new OffsetError(`offsetting by ${d} turned an outline inside out`);
    for (const h of r.holes) {
      const cw = signedArea(polyline(h)) > 0 ? reverseLoop(h) : h;
      const oh = offsetLoop(cw, d, round);
      if (oh) out.push(oh);
    }
  }
  return out;
}

export type { Seg2 };
