/**
 * Seeded random IR generator for the kernel fuzzer. Every tree it makes is *valid input*: positive
 * sizes, simple (non-self-intersecting) closed profiles, proper rigid transforms — so a kernel
 * error on a boolean/primitive/sweep is a kernel failure, not bad input. It deliberately favours
 * the configurations kernels find hard: touching, coplanar, tangent, coincident and
 * near-coincident operands, mirrored and rotated placements.
 */
import type { Curve, Node, Selector } from "../../src/ir";

export type V3 = [number, number, number];

/** mulberry32 */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
    /** "Nice" numbers most of the time (integers, halves): exact coincidences happen more. */
    nice: (lo: number, hi: number) => {
      const r = next();
      const v = lo + (hi - lo) * next();
      return r < 0.45 ? Math.max(lo, Math.round(v)) : r < 0.7 ? Math.max(lo, Math.round(v * 2) / 2) : +v.toFixed(3);
    },
  };
}
export type Rng = ReturnType<typeof rng>;

/** A node with a conservative axis-aligned bounding box. */
export interface Gen {
  node: Node;
  lo: V3;
  hi: V3;
}

const r3 = (v: number) => +v.toFixed(6);

// ---- transforms

function matMul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[i * 4 + j] += a[i * 4 + k]! * b[k * 4 + j]!;
  return o;
}
function rotAxis(axis: V3, deg: number): number[] {
  const l = Math.hypot(...axis);
  const [x, y, z] = axis.map((v) => v / l) as V3;
  const q = ((deg % 360) + 360) % 360;
  const c = q === 90 ? 0 : q === 180 ? -1 : q === 270 ? 0 : Math.cos((deg * Math.PI) / 180);
  const s = q === 90 ? 1 : q === 180 ? 0 : q === 270 ? -1 : Math.sin((deg * Math.PI) / 180);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1];
}
function apply(m: number[], p: V3): V3 {
  return [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!, m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!, m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!];
}
export function translate(g: Gen, d: V3): Gen {
  if (d[0] === 0 && d[1] === 0 && d[2] === 0) return g;
  return transform(g, [1, 0, 0, d[0], 0, 1, 0, d[1], 0, 0, 1, d[2], 0, 0, 0, 1]);
}
export function transform(g: Gen, m: number[]): Gen {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = apply(m, [i & 1 ? g.hi[0] : g.lo[0], i & 2 ? g.hi[1] : g.lo[1], i & 4 ? g.hi[2] : g.lo[2]]);
    for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
  }
  return { node: { type: "transform", matrix: m.map(r3) as any, children: [g.node] }, lo, hi };
}

function randomPlacement(R: Rng, g: Gen): Gen {
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const kind = R.next();
  if (kind < 0.3) m = rotAxis(R.pick<V3>([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), R.pick([90, 180, 270]));
  else if (kind < 0.5) m = rotAxis([R.range(-1, 1), R.range(-1, 1), R.range(0.1, 1)], R.range(5, 175));
  else if (kind < 0.6) m = rotAxis([0, 0, 1], R.pick([30, 45, 60]));
  if (R.chance(0.12)) {
    const ax = R.int(0, 2);
    const mir = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    mir[ax * 5] = -1;
    m = matMul(mir, m);
  }
  m[3] = R.nice(-15, 15);
  m[7] = R.nice(-15, 15);
  m[11] = R.nice(-10, 10);
  return transform(g, m);
}

// ---- profiles (closed loops in the XY plane, CCW)

const line = (a: V3, b: V3): Curve => ({ type: "line", start: a, end: b });
function polyLoop(pts: [number, number][]): Curve[] {
  return pts.map((p, i) => line([r3(p[0]), r3(p[1]), 0], [r3(pts[(i + 1) % pts.length]![0]), r3(pts[(i + 1) % pts.length]![1]), 0]));
}
function starPoly(R: Rng): [number, number][] {
  const n = R.int(3, 9);
  const star = R.chance(0.3);
  const r0 = R.nice(3, 20);
  const angles = Array.from({ length: star ? 2 * n : n }, (_, i) => (2 * Math.PI * i) / (star ? 2 * n : n) + (R.chance(0.5) ? 0 : R.range(-0.2, 0.2) / n));
  return angles.map((a, i) => {
    const r = star && i % 2 ? r0 * R.range(0.35, 0.7) : r0 * (R.chance(0.6) ? 1 : R.range(0.7, 1.2));
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}
function roundedRect(R: Rng): Curve[] {
  const w = R.nice(4, 40), h = R.nice(4, 40);
  const r = R.chance(0.2) ? Math.min(w, h) / 2 : R.nice(0.5, Math.min(w, h) / 2 - 0.1);
  const x = w / 2, y = h / 2, P = Math.PI / 2;
  const arc = (cx: number, cy: number, a0: number): Curve => ({ type: "arc", center: [r3(cx), r3(cy), 0], axis: [0, 0, 1], reference: [1, 0, 0], radius: r3(r), start: a0, end: a0 + P });
  const segs: Curve[] = [];
  const L = (a: [number, number], b: [number, number]) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) segs.push(line([r3(a[0]), r3(a[1]), 0], [r3(b[0]), r3(b[1]), 0]));
  };
  L([-x + r, -y], [x - r, -y]);
  segs.push(arc(x - r, -y + r, -P));
  L([x, -y + r], [x, y - r]);
  segs.push(arc(x - r, y - r, 0));
  L([x - r, y], [-x + r, y]);
  segs.push(arc(-x + r, y - r, P));
  L([-x, y - r], [-x, -y + r]);
  segs.push(arc(-x + r, -y + r, 2 * P));
  return segs;
}
function circleLoop(R: Rng): Curve[] {
  return [{ type: "arc", center: [0, 0, 0], axis: [0, 0, 1], reference: [1, 0, 0], radius: R.nice(1, 20), start: 0, end: 2 * Math.PI }];
}
function loopBox(loop: Curve[]): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, 0], hi: V3 = [-Infinity, -Infinity, 0];
  for (const c of loop) {
    const pts: number[][] = c.type === "line" ? [c.start, c.end] : c.type === "arc" ? [[c.center[0] - c.radius, c.center[1] - c.radius], [c.center[0] + c.radius, c.center[1] + c.radius]] : c.points;
    for (const p of pts) for (let k = 0; k < 2; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
  }
  return [lo, hi];
}

// ---- primitives

export function primitive(R: Rng): Gen {
  const k = R.next();
  if (k < 0.2) {
    const s: V3 = [R.nice(1, 40), R.nice(1, 40), R.nice(1, 40)];
    const center = R.chance(0.3);
    return { node: { type: "box", size: s, ...(center ? { center } : {}) }, lo: center ? (s.map((v) => -v / 2) as V3) : [0, 0, 0], hi: center ? (s.map((v) => v / 2) as V3) : s };
  }
  if (k < 0.36) {
    const r = R.nice(0.5, 20), h = R.nice(1, 40), center = R.chance(0.3);
    return { node: { type: "cylinder", radius: r, height: h, ...(center ? { center } : {}) }, lo: [-r, -r, center ? -h / 2 : 0], hi: [r, r, center ? h / 2 : h] };
  }
  if (k < 0.44) {
    const r = R.nice(0.5, 20);
    return { node: { type: "sphere", radius: r }, lo: [-r, -r, -r], hi: [r, r, r] };
  }
  if (k < 0.52) {
    const r1 = R.nice(0.5, 20), r2 = R.chance(0.3) ? 0 : R.nice(0.5, 20), h = R.nice(1, 30);
    const m = Math.max(r1, r2);
    return { node: { type: "cone", bottomRadius: r1, topRadius: r2, height: h }, lo: [-m, -m, 0], hi: [m, m, h] };
  }
  if (k < 0.58) {
    const R0 = R.nice(3, 20), r = Math.min(R0 - 0.2, R.nice(0.5, 8));
    return { node: { type: "torus", majorRadius: R0, minorRadius: r }, lo: [-R0 - r, -R0 - r, -r], hi: [R0 + r, R0 + r, r] };
  }
  if (k < 0.82) {
    const loop = R.pick([starPoly, roundedRect, circleLoop])(R);
    const profile = Array.isArray(loop[0]) ? polyLoop(loop as any) : (loop as Curve[]);
    const d = R.nice(1, 30);
    const draft = R.chance(0.12) ? +R.range(-0.15, 0.25).toFixed(3) : undefined;
    const [lo, hi] = loopBox(profile);
    return { node: { type: "extrude", profile, direction: [0, 0, 1], distance: d, ...(draft ? { draft } : {}) }, lo: [lo[0], lo[1], 0], hi: [hi[0], hi[1], d] };
  }
  if (k < 0.94) {
    // revolve a polygon in the XZ plane (x = radius ≥ 0) about Z
    const h = R.nice(2, 30);
    const n = R.int(1, 4);
    const pts: [number, number][] = [[0, 0]];
    const touchAxis = R.chance(0.6);
    const xs: number[] = [];
    for (let i = 0; i <= n; i++) xs.push(R.nice(1, 18));
    const inner0 = R.nice(0.5, Math.max(0.6, Math.min(...xs) - 0.5));
    const axisX = touchAxis ? 0 : Math.min(inner0, Math.min(...xs) - 0.25);
    pts[0] = [axisX, 0];
    xs.forEach((x, i) => pts.push([x, (h * i) / n]));
    pts.push([axisX, h]);
    const profile: Curve[] = pts.map((p, i) => line([r3(p[0]), 0, r3(p[1])], [r3(pts[(i + 1) % pts.length]![0]), 0, r3(pts[(i + 1) % pts.length]![1])]));
    const angle = R.chance(0.7) ? 2 * Math.PI : +R.range(0.5, 6).toFixed(3);
    const m = Math.max(...xs);
    return { node: { type: "revolve", profile, origin: [0, 0, 0], axis: [0, 0, 1], angle }, lo: [-m, -m, 0], hi: [m, m, h] };
  }
  // loft between two sections
  const a = R.nice(4, 20), b = R.nice(2, 20), h = R.nice(2, 25);
  const sq = (s: number, z: number): Curve[] => polyLoop([[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]]).map((c) => (c.type === "line" ? { ...c, start: [c.start[0], c.start[1], z] as V3, end: [c.end[0], c.end[1], z] as V3 } : c));
  const top: Curve[] = R.chance(0.5) ? sq(b, h) : [{ type: "arc", center: [0, 0, h], axis: [0, 0, 1], reference: [1, 0, 0], radius: b / 2, start: 0, end: 2 * Math.PI }];
  const m = Math.max(a, b) / 2;
  return { node: { type: "loft", sections: [sq(a, 0), top], ...(R.chance(0.3) ? { ruled: true } : {}) }, lo: [-m, -m, 0], hi: [m, m, h] };
}

// ---- booleans with hard configurations

/** Place `b` relative to `a` in a configuration chosen to stress the boolean. */
function arrange(R: Rng, a: Gen, b: Gen): { b: Gen; mode: string } {
  const ca = a.lo.map((v, i) => (v + a.hi[i]!) / 2) as V3;
  const cb = b.lo.map((v, i) => (v + b.hi[i]!) / 2) as V3;
  const mode = R.pick(["overlap", "overlap", "touch", "coplanar", "contain", "identical", "nudge", "tangent-cyl"]);
  const ax = R.int(0, 2);
  switch (mode) {
    case "overlap": {
      const d = ca.map((v, i) => r3(v - cb[i]! + R.nice(-0.4, 0.4) * (a.hi[i]! - a.lo[i]!))) as V3;
      return { b: translate(b, d), mode };
    }
    case "touch": {
      // b's min face on a's max face along one axis, overlapping in the others
      const d = ca.map((v, i) => r3(v - cb[i]!)) as V3;
      d[ax] = r3(a.hi[ax]! - b.lo[ax]!);
      return { b: translate(b, d), mode };
    }
    case "coplanar": {
      // shared min (or max) plane along one axis, overlapping in the others
      const d = ca.map((v, i) => r3(v - cb[i]! + R.nice(-0.3, 0.3) * (a.hi[i]! - a.lo[i]!))) as V3;
      d[ax] = R.chance(0.5) ? r3(a.lo[ax]! - b.lo[ax]!) : r3(a.hi[ax]! - b.hi[ax]!);
      return { b: translate(b, d), mode };
    }
    case "contain":
      return { b: translate(b, ca.map((v, i) => r3(v - cb[i]!)) as V3), mode };
    case "identical":
      return { b: a, mode };
    case "nudge": {
      const d: V3 = [0, 0, 0];
      d[ax] = R.pick([1e-7, 1e-5, 1e-3, -1e-6]);
      return { b: translate(a, d), mode };
    }
    default: {
      // a cylinder tangent (inside or outside) to one of a's bbox faces
      const r = R.nice(1, 10), h = (a.hi[2] - a.lo[2]) * R.pick([1, 0.5, 1.5]);
      const cyl: Gen = { node: { type: "cylinder", radius: r, height: r3(h) }, lo: [-r, -r, 0], hi: [r, r, h] };
      const inside = R.chance(0.5);
      const x = inside ? a.hi[0] - r : a.hi[0] + r;
      return { b: translate(cyl, [r3(x), r3(ca[1]), r3(a.lo[2] + (R.chance(0.5) ? 0 : (a.hi[2] - a.lo[2]) * 0.25))]), mode };
    }
  }
}

const AXES = ["x", "y", "z"] as const;
function selector(R: Rng, r: number): Selector {
  const k = R.next();
  if (k < 0.2) return { type: "all" };
  if (k < 0.4) return { type: "parallel", axis: R.pick(AXES) };
  if (k < 0.55) return { type: "perpendicular", axis: R.pick(AXES) };
  if (k < 0.7) return { type: R.pick(["max", "min"] as const), axis: R.pick(AXES) };
  if (k < 0.8) return { type: "radius", radius: r };
  if (k < 0.9) return { type: "and", of: [{ type: "max", axis: "z" }, { type: "parallel", axis: R.pick(["x", "y"] as const) }] };
  return { type: "not", of: { type: "min", axis: "z" } };
}

export interface Case {
  seed: number;
  /** `single`: one tree. `identity`: A and B (and their booleans) for the volume identities. */
  kind: "single" | "identity";
  node?: Node;
  a?: Node;
  b?: Node;
  mode?: string;
}

export function gen(R: Rng, depth: number): Gen {
  if (depth <= 0 || R.chance(0.3)) return R.chance(0.6) ? randomPlacement(R, primitive(R)) : primitive(R);
  const k = R.next();
  if (k < 0.55) {
    const a = gen(R, depth - 1);
    const { b } = arrange(R, a, gen(R, depth - 1));
    const type = R.pick(["union", "difference", "intersection", "difference"] as const);
    const lo = a.lo.map((v, i) => Math.min(v, b.lo[i]!)) as V3, hi = a.hi.map((v, i) => Math.max(v, b.hi[i]!)) as V3;
    return { node: { type, children: [a.node, b.node] }, lo, hi };
  }
  if (k < 0.85) {
    const c = gen(R, depth - 1);
    const size = Math.min(...c.hi.map((v, i) => v - c.lo[i]!));
    const f = R.next();
    if (f < 0.45) return { ...c, node: { type: "fillet", radius: r3(Math.max(0.1, size * R.pick([0.05, 0.1, 0.2, 0.35, 0.5]))), edges: selector(R, R.nice(0.5, 10)), children: [c.node] } };
    if (f < 0.8) return { ...c, node: { type: "chamfer", distance: r3(Math.max(0.1, size * R.pick([0.05, 0.1, 0.25, 0.45]))), edges: selector(R, R.nice(0.5, 10)), children: [c.node] } };
    const t = r3(Math.max(0.2, size * R.pick([0.05, 0.1, 0.2])));
    return { ...c, node: { type: "shell", thickness: R.chance(0.7) ? -t : t, faces: R.pick<Selector>([{ type: "max", axis: "z" }, { type: "none" }, { type: "min", axis: "z" }, { type: "max", axis: "x" }]), children: [c.node] } };
  }
  return randomPlacement(R, gen(R, depth - 1));
}

export function makeCase(seed: number): Case {
  const R = rng(seed);
  if (R.chance(0.3)) {
    const a = gen(R, R.int(0, 2));
    const { b, mode } = arrange(R, a, gen(R, R.int(0, 1)));
    return { seed, kind: "identity", a: a.node, b: b.node, mode };
  }
  return { seed, kind: "single", node: gen(R, R.int(1, 3)).node };
}
