/**
 * RoundedTag: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  length: { type: "int", default: 50, min: 30, max: 100, description: "Key tag: a plate with rounded corners (hull of four cylinders) and a key-ring hole" },
  width: { type: "int", default: 25, min: 15, max: 60 },
  thickness: { type: "number", default: 3, min: 1, max: 6, step: 0.5 },
  corner: { type: "int", default: 5, min: 1, max: 12 },
  hole: { type: "number", default: 3, min: 1, max: 6, step: 0.5 },
})

export default function RoundedTag(p: ParamValues<typeof params>) {
  const { length, width, thickness, corner, hole } = p
  return (
    <difference>
      <extrude height={thickness}>
        <hull>
          {[corner, length - corner].map((x: number) => [corner, width - corner].map((y: number) => <sketch at={[x, y]}><circle r={corner} /></sketch>))}
        </hull>
      </extrude>
      <translate by={[corner + 1, width / 2, -1]}><cylinder r={hole} h={thickness + 2} /></translate>
    </difference>
  )
}
