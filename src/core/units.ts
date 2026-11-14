/**
 * Unit helpers. tscad works in millimetres and degrees; these convert *to* those.
 * @example <box size={[inch(2), inch(1), 5]} rotate={[0, 0, rad(Math.PI / 4)]} />
 */

/** Millimetres (identity — for readability). */
export const mm = (v: number): number => v;
/** Centimetres → mm. */
export const cm = (v: number): number => v * 10;
/** Metres → mm. */
export const meters = (v: number): number => v * 1000;
/** Inches → mm. */
export const inch = (v: number): number => v * 25.4;
/** Feet → mm. */
export const ft = (v: number): number => v * 304.8;
/** Thousandths of an inch → mm. */
export const thou = (v: number): number => v * 0.0254;
/** Degrees (identity — for readability). */
export const deg = (v: number): number => v;
/** Radians → degrees. */
export const rad = (v: number): number => (v * 180) / Math.PI;
/** Turns → degrees (`turn(0.25)` = 90). */
export const turn = (v: number): number => v * 360;

/** `count` evenly spaced values from `a` to `b` inclusive (`linspace(0, 10, 3)` = [0, 5, 10]). */
export function linspace(a: number, b: number, count: number): number[] {
  if (count <= 1) return [a];
  return Array.from({ length: count }, (_, i) => a + ((b - a) * i) / (count - 1));
}
/** `[0, 1, ..., n-1]` — handy in JSX: `{range(4).map(i => <cylinder key={i} ... />)}`. */
export function range(n: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => i);
}
