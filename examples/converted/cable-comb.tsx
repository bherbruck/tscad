/**
 * CableComb: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  cables: { type: "int", default: 6, min: 2, max: 20, description: "Cable comb: keeps a bundle of wires parallel" },
  cable_d: { type: "number", default: 5.5, min: 2, max: 12, step: 0.1 },
  spacing: { type: "number", default: 2, min: 1, max: 6, step: 0.5 },
  thickness: { type: "int", default: 4, min: 2, max: 10 },
  slot: { type: "number", default: 0.8, description: "fraction of cable_d left open [0.5:0.05:1]" },
})

export default function CableComb(p: ParamValues<typeof params>) {
  const { cables, cable_d, spacing, thickness, slot } = p
  const pitch = cable_d + spacing
  const width = cables * pitch + spacing
  const height = cable_d + 2 * spacing
  return (
    <difference>
      <extrude height={thickness}>
        <offset distance={1}>
          <offset distance={-1} round={false}><rect size={[width, height]} center={false} /></offset>
        </offset>
      </extrude>
      <union>
        {$range(0, cables - 1).map((i: number) => (
          <>
            {(() => {
              const x = spacing + cable_d / 2 + i * pitch
              return (
                <>
                  <translate by={[x, height / 2, 0]}>
                    <extrude height={thickness}><circle r={cable_d / 2} /></extrude>
                  </translate>
                  <translate by={[x - cable_d * slot / 2, height / 2, 0]}>
                    <extrude height={thickness}><rect size={[cable_d * slot, height]} center={false} /></extrude>
                  </translate>
                </>
              )
            })()}
          </>
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
