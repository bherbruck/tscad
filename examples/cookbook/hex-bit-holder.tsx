/**
 * HexBitHolder: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  columns: { type: "int", default: 6, min: 2, max: 12, step: 1, description: "Bits per row", group: "Holder" },
  rows: { type: "int", default: 2, min: 1, max: 4, step: 1, description: "Rows", group: "Holder" },
  depth: { type: "int", default: 12, min: 6, max: 20, step: 1, description: "Socket depth", group: "Holder" },
  clearance: { type: "number", default: 0.3, min: 0, max: 0.6, step: 0.05, description: "Clearance on the hex", group: "Holder" },
  bit: { type: "number", default: 6.35, description: "1/4\" across flats", group: "Holder" },
  pitch: { type: "number", default: 11, group: "Holder" },
  base: { type: "number", default: 3, group: "Holder" },
})

export default function HexBitHolder(p: ParamValues<typeof params>) {
  const { columns, rows, depth, clearance, bit, pitch, base } = p
  /** OpenSCAD module socket() */
  function Socket() {
    return (
      <extrude height={depth + 1}>
        <regularPolygon sides={6} r={(bit + clearance) / Math.sqrt(3)} />
      </extrude>
    )
  }
  return (
    <difference>
      <translate by={[-columns * pitch / 2, -rows * pitch / 2, 0]}>
        <box size={[columns * pitch, rows * pitch, depth + base]} center={false} />
      </translate>
      <union>
        {$range(0, columns - 1).map((i: number) => (
          <>{$range(0, rows - 1).map((j: number) => (
            <translate by={[(i - (columns - 1) / 2) * pitch, (j - (rows - 1) / 2) * pitch, base]}>
              <Socket />
            </translate>
          ))}</>
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
