/**
 * GridBin: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type Children, type ParamValues } from "tscad"

export const params = defineParams({
  units_x: { type: "int", default: 2, min: 1, max: 6, description: "Gridfinity-style storage bin: rounded base pads on a 42 mm grid, hollow walls" },
  units_y: { type: "int", default: 1, min: 1, max: 6 },
  height_u: { type: "int", default: 3, min: 1, max: 10 },
})

/** OpenSCAD module rounded_square(s, r) */
function RoundedSquare({ s, r, $leaf = $leaf1 }: { s: any[]; r: number; /** Turns this module's 2D shapes into solids (extrude/revolve); set by the caller. */ $leaf?: (shape: Children) => Children }) {
  return (
    <>
      {$leaf(<offset distance={r}><rect size={[$sub(s[0]!, 2 * r), $sub(s[1]!, 2 * r)]} center /></offset>)}
    </>
  )
}

export default function GridBin(p: ParamValues<typeof params>) {
  const { units_x, units_y, height_u } = p
  const grid = 42
  const pad = 41.5
  const pad_r = 4
  const base_h = 5
  const unit_h = 7
  const wall = 1.2
  /** OpenSCAD module base_pad() */
  function BasePad() {
    return (
      <union>
        <translate by={[0, 0, 0]}>
          <RoundedSquare s={[pad - 4.3, pad - 4.3]} r={1.6} $leaf={(s) => <extrude height={0.8}>{s}</extrude>} />
        </translate>
        <translate by={[0, 0, 2.6]}>
          <RoundedSquare s={[pad, pad]} r={pad_r} $leaf={(s) => <extrude height={base_h - 2.6}>{s}</extrude>} />
        </translate>
      </union>
    )
  }
  /** OpenSCAD module bin_body() */
  function BinBody() {
    const w = units_x * grid - 0.5
    const d = units_y * grid - 0.5
    const h = height_u * unit_h
    return (
      <translate by={[0, 0, base_h]}>
        <difference>
          <RoundedSquare s={[w, d]} r={pad_r} $leaf={(s) => <extrude height={h}>{s}</extrude>} />
          <translate by={[0, 0, wall]}>
            <RoundedSquare s={[w - 2 * wall, d - 2 * wall]} r={pad_r - wall} $leaf={(s) => <extrude height={h}>{s}</extrude>} />
          </translate>
        </difference>
      </translate>
    )
  }
  return (
    <>
      {$range(0, units_x - 1).map((i: number) => (
        <>{$range(0, units_y - 1).map((j: number) => (
          <translate by={[(i - (units_x - 1) / 2) * grid, (j - (units_y - 1) / 2) * grid, 0]}>
            <BasePad />
          </translate>
        ))}</>
      ))}
      <BinBody />
    </>
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

/** OpenSCAD -: numbers, or vectors element-wise. */
function $sub(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return a.slice(0, Math.min(a.length, b.length)).map((x, i) => $sub(x, b[i]))
  return typeof a === "number" && typeof b === "number" ? a - b : undefined
}

/** A 2D shape used where a solid is expected: extruded 1 mm (OpenSCAD would keep it flat). */
function $leaf1(s: Children): Children {
  return <extrude height={1}>{s}</extrude>
}
