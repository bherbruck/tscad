/**
 * Cam: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  base_r: { type: "int", default: 12, min: 6, max: 30, description: "Plate cam: a base circle and a nose circle joined by tangents, with a bore" },
  nose_r: { type: "int", default: 5, min: 2, max: 15 },
  lift: { type: "int", default: 10, min: 2, max: 30 },
  thickness: { type: "int", default: 6, min: 2, max: 20 },
  bore: { type: "number", default: 6, min: 2, max: 12, step: 0.5 },
})

export default function Cam(p: ParamValues<typeof params>) {
  const { base_r, nose_r, lift, thickness, bore } = p
  return (
    <difference>
      <extrude height={thickness}>
        <hull>
          <circle r={base_r} />
          <sketch at={[base_r + lift - nose_r, 0]}><circle r={nose_r} /></sketch>
        </hull>
      </extrude>
      <extrude height={thickness}><circle r={bore / 2} /></extrude>
    </difference>
  )
}
