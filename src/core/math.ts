/**
 * Small affine-matrix toolkit. Matrices are 4x4, **row-major, column-vector** (`p' = M p`,
 * translation at indices 3, 7, 11): exactly the IR's `transform.matrix` layout.
 */
import type { Axis } from "../ir";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Mat4 = number[];

export const DEG = Math.PI / 180;

/** cos/sin of an angle in degrees, snapped so multiples of 90° are exact. */
export function cosSinDeg(deg: number): [number, number] {
  const r = (((deg % 360) + 360) % 360);
  if (r === 0) return [1, 0];
  if (r === 90) return [0, 1];
  if (r === 180) return [-1, 0];
  if (r === 270) return [0, -1];
  return [Math.cos(deg * DEG), Math.sin(deg * DEG)];
}

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a · b (apply b first, then a). */
export function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k]! * b[k * 4 + j]!;
      out[i * 4 + j] = s;
    }
  return out;
}

/** Compose left to right in *application* order: `chain(A, B, C)` applies A, then B, then C. */
export function chain(...ms: Mat4[]): Mat4 {
  let m = identity();
  for (const x of ms) m = mul(x, m);
  return m;
}

export function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

export function rotationX(deg: number): Mat4 {
  const [c, s] = cosSinDeg(deg);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}
export function rotationY(deg: number): Mat4 {
  const [c, s] = cosSinDeg(deg);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}
export function rotationZ(deg: number): Mat4 {
  const [c, s] = cosSinDeg(deg);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Rotation about X, then Y, then Z (fixed axes), degrees: `Rz · Ry · Rx`. */
export function rotationXYZ(rx: number, ry: number, rz: number): Mat4 {
  return chain(rotationX(rx), rotationY(ry), rotationZ(rz));
}

/** Rotation by `deg` about the unit-ised `axis` through the origin (Rodrigues). */
export function rotationAxis(axis: Vec3, deg: number): Mat4 {
  const [x, y, z] = normalize(axis);
  if (x === 0 && y === 0) return z > 0 ? rotationZ(deg) : rotationZ(-deg);
  if (y === 0 && z === 0) return x > 0 ? rotationX(deg) : rotationX(-deg);
  if (x === 0 && z === 0) return y > 0 ? rotationY(deg) : rotationY(-deg);
  const [c, s] = cosSinDeg(deg);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

export function scaling(sx: number, sy = sx, sz = sx): Mat4 {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

/** Reflection in the plane through the origin with normal `n` (`I - 2 n nᵀ`). */
export function reflection(n: Vec3): Mat4 {
  const [a, b, c] = normalize(n);
  return [
    1 - 2 * a * a, -2 * a * b, -2 * a * c, 0,
    -2 * a * b, 1 - 2 * b * b, -2 * b * c, 0,
    -2 * a * c, -2 * b * c, 1 - 2 * c * c, 0,
    0, 0, 0, 1,
  ];
}

export function axisVector(a: Axis): Vec3 {
  return a === "x" ? [1, 0, 0] : a === "y" ? [0, 1, 0] : [0, 0, 1];
}

export function isIdentity(m: Mat4, eps = 1e-12): boolean {
  const id = identity();
  return m.every((v, i) => Math.abs(v - id[i]!) <= eps);
}

/** Clean -0 and float dust (|v| < 1e-12) so IR snapshots and cache keys are stable. */
export function tidy(m: Mat4): Mat4 {
  return m.map((v) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) : v));
}

export function apply(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
    m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
    m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
  ];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}
/** Snap float dust to exact values (0, ±1, integers), to keep the emitted IR tidy. */
export function snap(v: number): number {
  if (Math.abs(v) < 1e-12) return 0;
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-12 ? r : v;
}
export const snap3 = (v: Vec3): Vec3 => [snap(v[0]), snap(v[1]), snap(v[2])];
