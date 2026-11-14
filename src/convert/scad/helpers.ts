/**
 * Runtime helpers the converted code may need (OpenSCAD semantics in TypeScript). Only the
 * helpers a file uses are copied into it, so converted models have no extra dependency.
 */

/** name → [source, dependencies] */
export const HELPERS: Record<string, [string, string[]]> = {
  $t: [`/** OpenSCAD truthiness: 0, "", [] and undef are false. */
function $t(v: any): boolean {
  return Array.isArray(v) ? v.length > 0 : !!v
}`, []],
  $range: [`/** An OpenSCAD range [a : step : b], inclusive. */
function $range(a: number, b: number, step = 1): number[] {
  const out: number[] = []
  if (step === 0 || (b - a) / step < 0) return out
  const n = Math.floor((b - a) / step + 1e-9)
  for (let i = 0; i <= n; i++) out.push(a + i * step)
  return out
}`, []],
  $iter: [`/** What a for loop iterates: a list's items, a number, or a string's characters. */
function $iter(v: any): any[] {
  return Array.isArray(v) ? v : typeof v === "string" ? [...v] : v === undefined ? [] : [v]
}`, []],
  $add: [`/** OpenSCAD +: numbers, or vectors element-wise. */
function $add(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return a.slice(0, Math.min(a.length, b.length)).map((x, i) => $add(x, b[i]))
  return typeof a === "number" && typeof b === "number" ? a + b : undefined
}`, []],
  $sub: [`/** OpenSCAD -: numbers, or vectors element-wise. */
function $sub(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return a.slice(0, Math.min(a.length, b.length)).map((x, i) => $sub(x, b[i]))
  return typeof a === "number" && typeof b === "number" ? a - b : undefined
}`, []],
  $neg: [`function $neg(a: any): any {
  return Array.isArray(a) ? a.map($neg) : typeof a === "number" ? -a : undefined
}`, []],
  $mul: [`/** OpenSCAD *: scalar × vector, dot product, matrix products. */
function $mul(a: any, b: any): any {
  const A = Array.isArray(a), B = Array.isArray(b)
  if (!A && !B) return typeof a === "number" && typeof b === "number" ? a * b : undefined
  if (!A) return b.map((x: any) => $mul(a, x))
  if (!B) return a.map((x: any) => $mul(x, b))
  const am = Array.isArray(a[0]), bm = Array.isArray(b[0])
  if (!am && !bm) return a.reduce((s: number, x: number, i: number) => s + x * b[i], 0)
  if (am && !bm) return a.map((row: any) => $mul(row, b))
  if (!am && bm) return b[0].map((_: any, j: number) => a.reduce((s: number, x: number, i: number) => s + x * b[i][j], 0))
  return a.map((row: any) => $mul(row, b))
}`, []],
  $div: [`/** OpenSCAD /: numbers, or a vector by a number. */
function $div(a: any, b: any): any {
  if (Array.isArray(a) && typeof b === "number") return a.map((x) => $div(x, b))
  return typeof a === "number" && typeof b === "number" ? a / b : undefined
}`, []],
  $eq: [`/** OpenSCAD ==: deep equality. */
function $eq(a: any, b: any): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => $eq(x, b[i]))
  return a === b
}`, []],
  $sin: [`function $sin(d: number): number {
  const r = ((d % 360) + 360) % 360
  return r === 0 || r === 180 ? 0 : r === 90 ? 1 : r === 270 ? -1 : Math.sin((d * Math.PI) / 180)
}`, []],
  $cos: [`function $cos(d: number): number {
  const r = ((d % 360) + 360) % 360
  return r === 90 || r === 270 ? 0 : r === 0 ? 1 : r === 180 ? -1 : Math.cos((d * Math.PI) / 180)
}`, []],
  $tan: [`function $tan(d: number): number {
  return Math.tan((d * Math.PI) / 180)
}`, []],
  $asin: [`function $asin(x: number): number {
  return (Math.asin(x) * 180) / Math.PI
}`, []],
  $acos: [`function $acos(x: number): number {
  return (Math.acos(x) * 180) / Math.PI
}`, []],
  $atan: [`function $atan(x: number): number {
  return (Math.atan(x) * 180) / Math.PI
}`, []],
  $atan2: [`function $atan2(y: number, x: number): number {
  return (Math.atan2(y, x) * 180) / Math.PI
}`, []],
  $round: [`/** OpenSCAD round: halves away from zero. */
function $round(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}`, []],
  $len: [`function $len(v: any): any {
  return Array.isArray(v) || typeof v === "string" ? v.length : undefined
}`, []],
  $concat: [`function $concat(...vs: any[]): any[] {
  return vs.flatMap((v) => (Array.isArray(v) ? v : [v]))
}`, []],
  $str: [`/** OpenSCAD str(): numbers as OpenSCAD prints them, vectors bracketed. */
function $str(...vs: any[]): string {
  const f = (v: any): string => (Array.isArray(v) ? \`[\${v.map(f).join(", ")}]\` : v === undefined ? "undef" : typeof v === "number" ? String(Number(v.toPrecision(6))) : String(v))
  return vs.map((v) => (typeof v === "string" ? v : f(v))).join("")
}`, []],
  $norm: [`function $norm(v: number[]): number {
  return Math.hypot(...v)
}`, []],
  $cross: [`function $cross(a: number[], b: number[]): any {
  if (a.length === 2) return a[0]! * b[1]! - a[1]! * b[0]!
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]
}`, []],
  $min: [`/** OpenSCAD min: of the arguments, or of one vector. */
function $min(...vs: any[]): number {
  return Math.min(...(vs.length === 1 && Array.isArray(vs[0]) ? vs[0] : vs))
}`, []],
  $max: [`/** OpenSCAD max: of the arguments, or of one vector. */
function $max(...vs: any[]): number {
  return Math.max(...(vs.length === 1 && Array.isArray(vs[0]) ? vs[0] : vs))
}`, []],
  $sign: [`function $sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0
}`, []],
  $lookup: [`/** OpenSCAD lookup(): linear interpolation in a [key, value] table. */
function $lookup(k: number, t: [number, number][]): number | undefined {
  if (!t.length) return undefined
  if (k <= t[0]![0]) return t[0]![1]
  for (let i = 1; i < t.length; i++) {
    const [k0, v0] = t[i - 1]!, [k1, v1] = t[i]!
    if (k <= k1) return v0 + ((v1 - v0) * (k - k0)) / (k1 - k0)
  }
  return t[t.length - 1]![1]
}`, []],
  $each: [`/** \`each\` in a list: a list's items (a range expanded). */
function $each(v: any): any[] {
  return Array.isArray(v) ? v : typeof v === "string" ? [...v] : [v]
}`, []],
  $v3: [`/** A point/offset as [x, y, z] (2D vectors get z = 0). */
function $v3(v: any): [number, number, number] {
  return Array.isArray(v) ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [v ?? 0, 0, 0]
}`, []],
  $s3: [`/** A scale factor as [sx, sy, sz] (a number scales evenly; 2D vectors keep z). */
function $s3(v: any): [number, number, number] {
  return Array.isArray(v) ? [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1] : [v, v, v]
}`, []],
  $s2: [`/** A 2D scale factor applied to an extrusion: [sx, sy, 1]. */
function $s2(v: any): [number, number, number] {
  return Array.isArray(v) ? [v[0] ?? 1, v[1] ?? 1, 1] : [v, v, 1]
}`, []],
  $rot: [`/** OpenSCAD rotate(a): a number turns about Z, a vector is [x, y, z] degrees. */
function $rot(a: any): [number, number, number] {
  return Array.isArray(a) ? [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0] : [0, 0, a ?? 0]
}`, []],
  $xy: [`function $xy(v: any): [number, number] {
  return Array.isArray(v) ? [v[0] ?? 0, v[1] ?? 0] : [v ?? 0, 0]
}`, []],
  $rz: [`/** The in-plane angle of a 2D rotate(): a number, or the z of a vector. */
function $rz(a: any): number {
  return Array.isArray(a) ? (a[2] ?? 0) : (a ?? 0)
}`, []],
  $paths: [`/** polygon(points, paths): each path's points (nested paths become holes). */
function $paths(points: [number, number][], paths?: number[][]): [number, number][][] {
  return paths ? paths.map((p) => p.map((i) => points[i]!)) : [points]
}`, []],
  $child: [`/** OpenSCAD children(i) / children([i, j]). */
function $child(children: any, i: any): any {
  const all = (Array.isArray(children) ? children : [children]).flat(Infinity).filter((c: any) => c != null && c !== false)
  return Array.isArray(i) ? i.map((k: number) => all[k]) : all[i]
}`, []],
  $count: [`/** OpenSCAD $children. */
function $count(children: any): number {
  return (Array.isArray(children) ? children : [children]).flat(Infinity).filter((c: any) => c != null && c !== false).length
}`, []],
  $is: [`/** OpenSCAD is_num / is_list / is_string / is_bool / is_undef / is_function. */
function $is(kind: string, v: any): boolean {
  switch (kind) {
    case "num": return typeof v === "number" && !Number.isNaN(v)
    case "list": return Array.isArray(v)
    case "string": return typeof v === "string"
    case "bool": return typeof v === "boolean"
    case "undef": return v === undefined
    default: return typeof v === "function"
  }
}`, []],
  $leaf1: [`/** A 2D shape used where a solid is expected: extruded 1 mm (OpenSCAD would keep it flat). */
function $leaf1(s: Children): Children {
  return <extrude height={1}>{s}</extrude>
}`, []],
};

/** Helpers needed (dependencies included), in a stable order. */
export function helperSource(used: Set<string>): string {
  const all = new Set<string>();
  const add = (n: string) => {
    if (all.has(n)) return;
    all.add(n);
    for (const d of HELPERS[n]?.[1] ?? []) add(d);
  };
  for (const n of used) add(n);
  return Object.keys(HELPERS)
    .filter((n) => all.has(n))
    .map((n) => HELPERS[n]![0])
    .join("\n\n");
}
