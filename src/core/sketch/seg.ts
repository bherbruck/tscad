/**
 * 2D sketch geometry: segments (line / arc / NURBS), loops, 2D affine transforms, sampling.
 */
import type { Vec2 } from "../math";

/** A straight segment. */
export interface Line2 {
  kind: "line";
  a: Vec2;
  b: Vec2;
}
/** A circular arc from angle `a0` to `a1` (radians): CCW when `a1 > a0`, CW otherwise. */
export interface Arc2 {
  kind: "arc";
  c: Vec2;
  r: number;
  a0: number;
  a1: number;
}
/** A NURBS curve: control points `[x, y, w]` (Cartesian + weight) and a clamped knot vector. */
export interface Nurbs2 {
  kind: "nurbs";
  degree: number;
  pts: [number, number, number][];
  knots: number[];
}
export type Seg2 = Line2 | Arc2 | Nurbs2;
/** A closed loop: segments end to end. */
export type Loop2 = Seg2[];

export const TAU = Math.PI * 2;

export function line(a: Vec2, b: Vec2): Line2 {
  return { kind: "line", a, b };
}
export function arc(c: Vec2, r: number, a0: number, a1: number): Arc2 {
  return { kind: "arc", c, r, a0, a1 };
}

function cs(t: number): Vec2 {
  // exact at multiples of π/2 so arc ends meet line ends exactly
  const q = t / (Math.PI / 2);
  const k = Math.round(q);
  if (Math.abs(q - k) < 1e-12) {
    const m = ((k % 4) + 4) % 4;
    return m === 0 ? [1, 0] : m === 1 ? [0, 1] : m === 2 ? [-1, 0] : [0, -1];
  }
  return [Math.cos(t), Math.sin(t)];
}

export function arcPoint(s: Arc2, t: number): Vec2 {
  const [c, sn] = cs(t);
  return [s.c[0] + s.r * c, s.c[1] + s.r * sn];
}

export function start(s: Seg2): Vec2 {
  switch (s.kind) {
    case "line":
      return s.a;
    case "arc":
      return arcPoint(s, s.a0);
    case "nurbs":
      return [s.pts[0]![0], s.pts[0]![1]];
  }
}
export function end(s: Seg2): Vec2 {
  switch (s.kind) {
    case "line":
      return s.b;
    case "arc":
      return arcPoint(s, s.a1);
    case "nurbs": {
      const p = s.pts[s.pts.length - 1]!;
      return [p[0], p[1]];
    }
  }
}

/** Evaluate a rational B-spline at `u` (de Boor on homogeneous points). */
export function nurbsPoint(s: Nurbs2, u: number): Vec2 {
  const p = s.degree;
  const U = s.knots;
  const n = s.pts.length - 1;
  let k = p;
  if (u >= U[n + 1]!) k = n;
  else while (k < n && !(u >= U[k]! && u < U[k + 1]!)) k++;
  const d: [number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const [x, y, w] = s.pts[j + k - p]!;
    d.push([x * w, y * w, w]);
  }
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = U[i + p - r + 1]! - U[i]!;
      const a = den === 0 ? 0 : (u - U[i]!) / den;
      const A = d[j - 1]!, B = d[j]!;
      d[j] = [(1 - a) * A[0] + a * B[0], (1 - a) * A[1] + a * B[1], (1 - a) * A[2] + a * B[2]];
    }
  const q = d[p]!;
  return [q[0] / q[2], q[1] / q[2]];
}

/** Points along the segment, including both ends. */
export function sample(s: Seg2, n = 16): Vec2[] {
  switch (s.kind) {
    case "line":
      return [s.a, s.b];
    case "arc": {
      const steps = Math.max(2, Math.ceil((Math.abs(s.a1 - s.a0) / TAU) * 64));
      return Array.from({ length: steps + 1 }, (_, i) => arcPoint(s, s.a0 + ((s.a1 - s.a0) * i) / steps));
    }
    case "nurbs": {
      const u0 = s.knots[0]!, u1 = s.knots[s.knots.length - 1]!;
      const steps = Math.max(n, s.pts.length * 4);
      return Array.from({ length: steps + 1 }, (_, i) => nurbsPoint(s, u0 + ((u1 - u0) * i) / steps));
    }
  }
}

/** The loop as a closed polyline (last point not repeated). */
export function polyline(loop: Loop2): Vec2[] {
  const pts: Vec2[] = [];
  for (const s of loop) {
    const p = sample(s);
    pts.push(...p.slice(0, -1));
  }
  return pts;
}

export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Even-odd point-in-polygon. */
export function inside(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

export function reverseSeg(s: Seg2): Seg2 {
  switch (s.kind) {
    case "line":
      return line(s.b, s.a);
    case "arc":
      return arc(s.c, s.r, s.a1, s.a0);
    case "nurbs": {
      const u0 = s.knots[0]!, u1 = s.knots[s.knots.length - 1]!;
      return { kind: "nurbs", degree: s.degree, pts: [...s.pts].reverse(), knots: [...s.knots].reverse().map((k) => u0 + u1 - k) };
    }
  }
}
export function reverseLoop(loop: Loop2): Loop2 {
  return [...loop].reverse().map(reverseSeg);
}

// ---------------------------------------------------------------------------------------------
// 2D affine transforms [a, b, c, d, e, f]: x' = a x + b y + e, y' = c x + d y + f

export type Affine2 = [number, number, number, number, number, number];
export const ID2: Affine2 = [1, 0, 0, 1, 0, 0];

export function mul2(m: Affine2, n: Affine2): Affine2 {
  // m · n (n first)
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[0] * n[4] + m[1] * n[5] + m[4],
    m[2] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function tr2(x: number, y: number): Affine2 {
  return [1, 0, 0, 1, x, y];
}
export function rot2(deg: number): Affine2 {
  const t = (deg * Math.PI) / 180;
  const [c, s] = cs(t);
  return [c, -s, s, c, 0, 0];
}
export function apply2(m: Affine2, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];
}
export function isId2(m: Affine2): boolean {
  return m.every((v, i) => v === ID2[i]);
}

/** Transform a segment by a similarity (rotation/reflection + uniform scale + translation). */
export function transformSeg(s: Seg2, m: Affine2): Seg2 {
  switch (s.kind) {
    case "line":
      return line(apply2(m, s.a), apply2(m, s.b));
    case "nurbs":
      return { ...s, pts: s.pts.map(([x, y, w]) => [...apply2(m, [x, y]), w] as [number, number, number]) };
    case "arc": {
      const det = m[0] * m[3] - m[1] * m[2];
      const k = Math.sqrt(Math.abs(det));
      const theta = Math.atan2(m[2], m[0]);
      const c = apply2(m, s.c);
      if (det > 0) return arc(c, s.r * k, s.a0 + theta, s.a1 + theta);
      // reflection: angle φ ↦ θ' - φ where θ' is the image direction of the x axis
      return arc(c, s.r * k, theta - s.a0, theta - s.a1);
    }
  }
}
export function transformLoop(loop: Loop2, m: Affine2): Loop2 {
  return isId2(m) ? loop : loop.map((s) => transformSeg(s, m));
}

/** Largest gap between consecutive segment ends (including the closing join). */
export function closureGap(loop: Loop2): { gap: number; at: number } {
  let gap = 0, at = -1;
  for (let i = 0; i < loop.length; i++) {
    const e = end(loop[i]!), s = start(loop[(i + 1) % loop.length]!);
    const g = Math.hypot(e[0] - s[0], e[1] - s[1]);
    if (g > gap) {
      gap = g;
      at = i;
    }
  }
  return { gap, at };
}

/** Loop bounding-box diagonal (for relative tolerances). */
export function loopSize(loop: Loop2): number {
  const p = polyline(loop);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return Math.hypot(x1 - x0, y1 - y0);
}
