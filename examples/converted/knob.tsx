/**
 * Knob: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  radius: { type: "int", default: 15, min: 8, max: 40, description: "Customizable knob with grip notches and a D-shaft bore" },
  height: { type: "int", default: 12, min: 5, max: 30 },
  notches: { type: "int", default: 12, min: 0, max: 36 },
  notch_r: { type: "number", default: 2, min: 1, max: 5, step: 0.5 },
  shaft_d: { type: "number", default: 6, min: 3, max: 10, step: 0.5 },
  flat: { type: "number", default: 1.5, description: "distance from the shaft axis to the flat" },
  bore_depth: { type: "number", default: 9 },
})

/** OpenSCAD module d_shaft(d, depth, flat) */
function DShaft({ d, depth, flat }: { d: number; depth: number; flat: number }) {
  return (
    <difference>
      <cylinder r={d / 2} h={depth} />
      <translate by={[flat, -d, -1]}><box size={[2 * d, 2 * d, depth + 2]} center={false} /></translate>
    </difference>
  )
}

export default function Knob(p: ParamValues<typeof params>) {
  const { radius, height, notches, notch_r, shaft_d, flat, bore_depth } = p
  return (
    <difference>
      <cylinder r={radius} h={height} />
      <union>
        {$range(0, notches - 1).map((i: number) => (
          <rotate by={[0, 0, i * 360 / notches]}>
            <translate by={[radius, 0, -1]}><cylinder r={notch_r} h={height + 2} /></translate>
          </rotate>
        ))}
      </union>
      <translate by={[0, 0, -1]}><DShaft d={shaft_d} depth={bore_depth + 1} flat={flat} /></translate>
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
