/**
 * V-belt pulley: the half cross-section is a constraint sketch (x = radius, y = axial),
 * revolved about Z. The lower half is dimensioned from the axis; the upper half is a mirror
 * image through `symmetric` constraints, so the groove stays centred whatever the params.
 *
 *   tscad dev examples/sketch-pulley.tsx
 */
import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  diameter: { type: "number", default: 80, min: 30, max: 200, step: 1, unit: "mm", label: "Outside Ø" },
  width: { type: "number", default: 20, min: 8, max: 60, step: 0.5, unit: "mm", label: "Width" },
  bore: { type: "number", default: 10, min: 3, max: 40, step: 0.5, unit: "mm", label: "Bore Ø" },
  hub: { type: "number", default: 26, min: 8, max: 80, step: 0.5, unit: "mm", label: "Hub Ø" },
  rimThickness: { type: "number", default: 14, min: 6, max: 40, step: 0.5, unit: "mm", label: "Rim (radial)" },
  web: { type: "number", default: 6, min: 2, max: 30, step: 0.5, unit: "mm", label: "Web thickness" },
  grooveAngle: { type: "number", default: 38, min: 20, max: 60, step: 1, unit: "°", label: "Groove angle" },
  grooveDepth: { type: "number", default: 8, min: 2, max: 20, step: 0.5, unit: "mm", label: "Groove depth" },
  grooveBottom: { type: "number", default: 4, min: 1, max: 20, step: 0.5, unit: "mm", label: "Groove bottom width" },
})

/** Lower-half points and their mirror images across the mid-plane. */
const PAIRS = [["b0", "b1"], ["h0", "h1"], ["w0", "w1"], ["k0", "k1"], ["r0", "r1"], ["o0", "o1"], ["g0", "g1"], ["q0", "q1"]] as const

export default function Pulley(p: ParamValues<typeof params>) {
  const R = p.diameter / 2
  return (
    <part name="pulley" material="aluminum">
      <revolve>
        <sketch>
          <point id="axis" x={0} y={0} fixed />
          <point id="mid" x={0} y={p.width / 2} fixed />

          {/* lower half, from the bore outwards: hub, web, rim, groove flank */}
          <point id="b0" x={p.bore / 2} y={0} fixed />
          <line from="b0" to="h0" horizontal />
          <line from="h0" to="w0" vertical />
          <line from="w0" to="k0" horizontal />
          <line from="k0" to="r0" vertical />
          <line from="r0" to="o0" horizontal />
          <line from="o0" to="g0" vertical />
          <line id="flank" from="g0" to="q0" angle={180 - p.grooveAngle / 2} />
          <line id="bottom" from="q0" to="q1" />
          <dimension a="q0" b="q1" dy={p.grooveBottom} />
          <horizontal a="b0" b="o0" />

          {/* dimensions from the axis */}
          <dimension a="axis" b="h0" dx={p.hub / 2} />
          <dimension a="axis" b="o0" dx={R} />
          <dimension a="k0" b="o0" dx={p.rimThickness} />
          <dimension a="q0" b="o0" dx={p.grooveDepth} />
          <dimension a="axis" b="w0" dy={(p.width - p.web) / 2} />

          {/* upper half: mirror images, joined back up */}
          {PAIRS.map(([a, b]) => <symmetric a={a} b={b} about="mid" axis="y" />)}
          <line from="q1" to="g1" />
          <line from="g1" to="o1" />
          <line from="o1" to="r1" />
          <line from="r1" to="k1" />
          <line from="k1" to="w1" />
          <line from="w1" to="h1" />
          <line from="h1" to="b1" />
          <line from="b1" to="b0" />
        </sketch>
      </revolve>
    </part>
  )
}
