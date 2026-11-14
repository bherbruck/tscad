/**
 * Forward-mode automatic differentiation with dense local gradients. Each constraint touches
 * a handful of variables, so its residual is evaluated on duals of that length and yields an
 * exact (analytic) Jacobian row block.
 */
export class D {
  constructor(
    readonly v: number,
    readonly g: Float64Array,
  ) {}
}

export function konst(v: number, n: number): D {
  return new D(v, new Float64Array(n));
}
/** The i-th of n independent variables, at value v. */
export function variable(v: number, i: number, n: number): D {
  const g = new Float64Array(n);
  g[i] = 1;
  return new D(v, g);
}

function lin(a: D, ka: number, b: D, kb: number, v: number): D {
  const g = new Float64Array(a.g.length);
  for (let i = 0; i < g.length; i++) g[i] = ka * a.g[i]! + kb * b.g[i]!;
  return new D(v, g);
}
function scaled(a: D, k: number, v: number): D {
  const g = new Float64Array(a.g.length);
  for (let i = 0; i < g.length; i++) g[i] = k * a.g[i]!;
  return new D(v, g);
}

export const add = (a: D, b: D): D => lin(a, 1, b, 1, a.v + b.v);
export const sub = (a: D, b: D): D => lin(a, 1, b, -1, a.v - b.v);
export const mul = (a: D, b: D): D => lin(a, b.v, b, a.v, a.v * b.v);
export const div = (a: D, b: D): D => lin(a, 1 / b.v, b, -a.v / (b.v * b.v), a.v / b.v);
export const neg = (a: D): D => scaled(a, -1, -a.v);
/** a · k for a plain number k. */
export const sc = (a: D, k: number): D => scaled(a, k, a.v * k);
/** a + k for a plain number k. */
export const addc = (a: D, k: number): D => new D(a.v + k, a.g);
export const sqrt = (a: D): D => {
  const s = Math.sqrt(Math.max(a.v, 0));
  return scaled(a, 0.5 / Math.max(s, 1e-150), s);
};
export const sin = (a: D): D => scaled(a, Math.cos(a.v), Math.sin(a.v));
export const cos = (a: D): D => scaled(a, -Math.sin(a.v), Math.cos(a.v));
/** atan2(y, x) with its gradient. */
export const atan2 = (y: D, x: D): D => {
  const r2 = Math.max(x.v * x.v + y.v * y.v, 1e-300);
  return lin(y, x.v / r2, x, -y.v / r2, Math.atan2(y.v, x.v));
};
/** Shift the value by a constant (wrap an angle) without touching the gradient. */
export const shift = (a: D, k: number): D => new D(a.v + k, a.g);

/** A 2D point of duals. */
export type P = [D, D];
export const vsub = (a: P, b: P): P => [sub(a[0], b[0]), sub(a[1], b[1])];
export const dot = (a: P, b: P): D => add(mul(a[0], b[0]), mul(a[1], b[1]));
export const cross = (a: P, b: P): D => sub(mul(a[0], b[1]), mul(a[1], b[0]));
export const norm = (a: P): D => sqrt(addc(dot(a, a), 1e-300));
export const dist = (a: P, b: P): D => norm(vsub(a, b));

/** Wrap an angle residual to (−π, π] (value only). */
export function wrapPi(a: D): D {
  let v = a.v;
  const k = Math.round(v / (2 * Math.PI));
  v -= k * 2 * Math.PI;
  return shift(a, v - a.v);
}
/** Wrap to (−π/2, π/2] (undirected lines). */
export function wrapHalfPi(a: D): D {
  const k = Math.round(a.v / Math.PI);
  return shift(a, -k * Math.PI);
}
