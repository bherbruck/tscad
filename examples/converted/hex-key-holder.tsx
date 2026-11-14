/**
 * HexKeyHolder: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  spacing: { type: "int", default: 4, min: 2, max: 10 },
  depth: { type: "int", default: 15, min: 5, max: 40 },
  clearance: { type: "number", default: 0.3, min: 0, max: 1, step: 0.05 },
  base: { type: "number", default: 5 },
})

function across_corners(f: any): any {
  return $div(f, $cos(30))
}

export default function HexKeyHolder(p: ParamValues<typeof params>) {
  const { spacing, depth, clearance, base } = p
  const sizes = [1.5, 2, 2.5, 3, 4, 5, 6]
  const total = $add($add($add($add(offset_of($len(sizes) - 1), $div(across_corners($add(sizes[$len(sizes) - 1]!, clearance)), 2)), spacing), $div(across_corners($add(sizes[0]!, clearance)), 2)), spacing)
  const width = $add(across_corners($max(sizes) + clearance), 2 * spacing)
  function offset_of(i: any): any {
    return $eq(i, 0) ? 0 : $add($add($add(offset_of($sub(i, 1)), $div(across_corners($add(sizes[$sub(i, 1)]!, clearance)), 2)), spacing), $div(across_corners($add(sizes[i]!, clearance)), 2))
  }
  return (
    <difference>
      <translate by={[$sub(-spacing, $div(across_corners($add(sizes[0]!, clearance)), 2)), $div($neg(width), 2), 0]}>
        <box size={[total, width, depth + base]} center={false} />
      </translate>
      <union>
        {$range(0, $len(sizes) - 1).map((i: number) => (
          <translate by={[offset_of(i), 0, base]}>
            <extrude height={depth + 1}>
              <regularPolygon sides={6} r={(across_corners($add(sizes[i]!, clearance))) / 2} />
            </extrude>
          </translate>
        ))}
      </union>
    </difference>
  )
}

// ---- OpenSCAD semantics used above

/** An OpenSCAD range [a : step : b], inclusive. */
function $range(a: number, b: number, step = 1): number[] {
  const out: number[] = []
  if (step === 0 || (b - a) / step < 0) return out
  const n = Math.floor((b - a) / step + 1e-9)
  for (let i = 0; i <= n; i++) out.push(a + i * step)
  return out
}

/** OpenSCAD +: numbers, or vectors element-wise. */
function $add(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return a.slice(0, Math.min(a.length, b.length)).map((x, i) => $add(x, b[i]))
  return typeof a === "number" && typeof b === "number" ? a + b : undefined
}

/** OpenSCAD -: numbers, or vectors element-wise. */
function $sub(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return a.slice(0, Math.min(a.length, b.length)).map((x, i) => $sub(x, b[i]))
  return typeof a === "number" && typeof b === "number" ? a - b : undefined
}

function $neg(a: any): any {
  return Array.isArray(a) ? a.map($neg) : typeof a === "number" ? -a : undefined
}

/** OpenSCAD /: numbers, or a vector by a number. */
function $div(a: any, b: any): any {
  if (Array.isArray(a) && typeof b === "number") return a.map((x) => $div(x, b))
  return typeof a === "number" && typeof b === "number" ? a / b : undefined
}

/** OpenSCAD ==: deep equality. */
function $eq(a: any, b: any): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => $eq(x, b[i]))
  return a === b
}

function $cos(d: number): number {
  const r = ((d % 360) + 360) % 360
  return r === 90 || r === 270 ? 0 : r === 0 ? 1 : r === 180 ? -1 : Math.cos((d * Math.PI) / 180)
}

function $len(v: any): any {
  return Array.isArray(v) || typeof v === "string" ? v.length : undefined
}

/** OpenSCAD max: of the arguments, or of one vector. */
function $max(...vs: any[]): number {
  return Math.max(...(vs.length === 1 && Array.isArray(vs[0]) ? vs[0] : vs))
}
