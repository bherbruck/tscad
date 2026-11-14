/**
 * Exact 2D convex hull of sketch loops: points and polygons stay exact, circles and arcs give
 * exact tangent segments and arcs (hulls of circles are slots, rounded polygons, cam profiles),
 * NURBS are flattened.
 *
 * Method: the hull's support function h(θ) = max over "sites" of their support in direction
 * θ. A site is a point, or a circular arc that only supports directions within its angular
 * range (its end points are separate point sites). Sweeping θ once round, the active site
 * changes at exact transition angles (where two supports are equal); an arc site contributes
 * an arc while active, and each change contributes the common tangent segment.
 */
import type { Vec2 } from "../math";
import { arc, arcPoint, end, line, sample, start, TAU, type Loop2, type Seg2 } from "./seg";

type Site = { kind: "pt"; p: Vec2 } | { kind: "arc"; c: Vec2; r: number; a0: number; span: number };

export class HullError extends Error {}

const wrap = (t: number) => ((t % TAU) + TAU) % TAU;

/** Is direction θ inside the arc site's CCW range [a0, a0 + span]? */
function inRange(s: Extract<Site, { kind: "arc" }>, t: number, eps = 1e-12): boolean {
  if (s.span >= TAU - 1e-12) return true;
  const d = wrap(t - s.a0);
  return d <= s.span + eps || d >= TAU - eps;
}

function support(s: Site, t: number): number {
  const ux = Math.cos(t), uy = Math.sin(t);
  if (s.kind === "pt") return s.p[0] * ux + s.p[1] * uy;
  return inRange(s, t) ? s.c[0] * ux + s.c[1] * uy + s.r : -Infinity;
}

function supportPoint(s: Site, t: number): Vec2 {
  if (s.kind === "pt") return s.p;
  return arcPoint(arc(s.c, s.r, t, t), t);
}

/** The sites of a set of loops. */
function sites(loops: Loop2[]): Site[] {
  const out: Site[] = [];
  const pts: Vec2[] = [];
  for (const loop of loops)
    for (const s of loop) {
      if (s.kind === "line") pts.push(s.a, s.b);
      else if (s.kind === "nurbs") pts.push(...sample(s, 64));
      else {
        const lo = Math.min(s.a0, s.a1), span = Math.abs(s.a1 - s.a0);
        if (span >= TAU - 1e-12) out.push({ kind: "arc", c: s.c, r: s.r, a0: 0, span: TAU });
        else {
          out.push({ kind: "arc", c: s.c, r: s.r, a0: wrap(lo), span });
          pts.push(start(s), end(s));
        }
      }
    }
  // drop duplicate points (shared loop corners)
  const seen = new Set<string>();
  for (const p of pts) {
    const k = `${p[0].toFixed(12)},${p[1].toFixed(12)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: "pt", p });
  }
  // a point inside an arc's own disc never supports alone; keep it anyway (cheap)
  return out;
}

/** The site with the largest support at θ (ties: the earlier one). */
function best(ss: Site[], t: number): number {
  let bi = -1, bv = -Infinity;
  ss.forEach((s, i) => {
    const v = support(s, t);
    if (bi < 0 ? v > -Infinity : v > bv + 1e-11 * Math.max(1, Math.abs(bv))) {
      bv = v;
      bi = i;
    }
  });
  return bi;
}

/** Where support(a) = support(b), between t1 and t2 (t1 < t2, unwrapped). */
function transition(a: Site, b: Site, t1: number, t2: number): number {
  // c·u + r form: point = arc of radius 0
  const ca = a.kind === "pt" ? a.p : a.c, cb = b.kind === "pt" ? b.p : b.c;
  const ra = a.kind === "pt" ? 0 : a.r, rb = b.kind === "pt" ? 0 : b.r;
  const dx = cb[0] - ca[0], dy = cb[1] - ca[1], L = Math.hypot(dx, dy);
  const cands: number[] = [];
  if (L > 1e-15) {
    const phi = Math.atan2(dy, dx);
    const c = (ra - rb) / L;
    if (Math.abs(c) <= 1 + 1e-12) {
      const g = Math.acos(Math.max(-1, Math.min(1, c)));
      cands.push(phi + g, phi - g);
    }
  }
  // arc range ends (a site switching to/from -∞)
  for (const s of [a, b]) if (s.kind === "arc" && s.span < TAU - 1e-12) cands.push(s.a0, s.a0 + s.span);
  const f = (t: number) => support(a, t) - support(b, t);
  for (const c of cands) {
    for (let k = -2; k <= 2; k++) {
      const t = c + k * TAU;
      if (t >= t1 - 1e-12 && t <= t2 + 1e-12) {
        // a genuine switch: a wins before, b after
        const e = Math.min(1e-9, (t2 - t1) / 4);
        if (f(t - e) >= -1e-9 && f(t + e) <= 1e-9) return Math.min(t2, Math.max(t1, t));
      }
    }
  }
  // fallback: bisection on the sign of f
  let lo = t1, hi = t2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The convex hull of `loops` as one CCW loop. Throws {@link HullError} when it is empty or flat. */
export function hullLoops(loops: Loop2[]): Loop2 {
  const ss = sites(loops);
  if (!ss.length) throw new HullError("nothing to hull");
  if (ss.length === 1 && ss[0]!.kind === "arc" && ss[0]!.span >= TAU - 1e-12) {
    const s = ss[0]!;
    return [arc(s.c, s.r, 0, TAU)];
  }
  // sweep: active sites and exact transition angles
  const N = 1440;
  const seq: { site: number; from: number }[] = [];
  const t0 = 0;
  let cur = best(ss, t0);
  seq.push({ site: cur, from: t0 });
  const refine = (a: number, ta: number, b: number, tb: number) => {
    // a active at ta, b at tb: find the switch, checking nothing else pokes out there
    const t = transition(ss[a]!, ss[b]!, ta, tb);
    const top = best(ss, t);
    const v = support(ss[a]!, t);
    if (top !== a && top !== b && support(ss[top]!, t) > v + 1e-9 * Math.max(1, Math.abs(v)) && tb - ta > 1e-12) {
      refine(a, ta, top, t);
      refine(top, t, b, tb);
      return;
    }
    seq.push({ site: b, from: t });
  };
  for (let i = 1; i <= N; i++) {
    const t = (TAU * i) / N;
    const b = best(ss, t);
    if (b !== cur) {
      refine(cur, (TAU * (i - 1)) / N, b, t);
      cur = b;
    }
  }
  // close: the last run wraps into the first
  if (seq.length > 1 && seq[seq.length - 1]!.site === seq[0]!.site) {
    const last = seq.pop()!;
    seq[0] = { site: seq[0]!.site, from: last.from - TAU };
  }
  if (seq.length === 1) {
    const s = ss[seq[0]!.site]!;
    if (s.kind === "arc") return [arc(s.c, s.r, 0, TAU)];
    throw new HullError("the hull is a single point");
  }
  // boundary: for each active run an arc (arc sites), between runs the tangent segment
  const segs: Seg2[] = [];
  const n = seq.length;
  for (let k = 0; k < n; k++) {
    const run = seq[k]!, next = seq[(k + 1) % n]!;
    const s = ss[run.site]!;
    let tEnd = next.from;
    while (tEnd <= run.from) tEnd += TAU;
    if (s.kind === "arc" && tEnd - run.from > 1e-12) segs.push(arc(s.c, s.r, run.from, tEnd));
    const p = supportPoint(s, tEnd);
    const nx = ss[next.site]!;
    const q = nx.kind === "arc" ? arcPoint(arc(nx.c, nx.r, next.from, next.from), next.from) : nx.p;
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-12) segs.push(line(p, q));
  }
  // join exactly: each segment starts where the previous one ended
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!, prev = segs[(i + segs.length - 1) % segs.length]!;
    if (s.kind === "line") s.a = end(prev);
  }
  if (segs.length < 2 && !(segs.length === 1 && segs[0]!.kind === "arc")) throw new HullError("the hull is flat (all points on one line)");
  const area = shoelace(segs);
  if (Math.abs(area) < 1e-18) throw new HullError("the hull is flat (all points on one line)");
  return segs;
}

function shoelace(segs: Seg2[]): number {
  let a = 0;
  for (const s of segs) {
    const p = start(s), q = end(s);
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
