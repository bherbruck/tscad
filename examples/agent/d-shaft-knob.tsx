/**
 * Replacement knob for a 6 mm D-shaft: a fluted grip, a pointer groove, and a D bore with a fit clearance.
 *
 * Brief: "a replacement knob for a 6 mm D-shaft"
 * Designed by an agent through the tscad MCP server (see docs/mcp-dogfood.md).
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  diameter: { type: "number", default: 30, min: 15, max: 60, step: 1, unit: "mm", label: "Knob Ø" },
  height: { type: "number", default: 16, min: 8, max: 40, step: 1, unit: "mm", label: "Height" },
  shaft: { type: "number", default: 6, min: 3, max: 10, step: 0.5, unit: "mm", label: "Shaft Ø" },
  flat: { type: "number", default: 4.5, min: 2, max: 9, step: 0.1, unit: "mm", label: "Across the flat" },
  depth: { type: "number", default: 12, min: 5, max: 30, step: 0.5, unit: "mm", label: "Shaft depth" },
  fit: { type: "number", default: 0.15, min: 0, max: 0.5, step: 0.05, unit: "mm", label: "Fit clearance" },
  grips: { type: "int", default: 24, min: 0, max: 60, label: "Grip flutes" },
})

export default function Knob(p: ParamValues<typeof params>) {
  const R = p.diameter / 2
  const r = p.shaft / 2 + p.fit
  const flatAt = p.flat - p.shaft / 2 + p.fit // from the shaft axis to the flat
  return (
    <part name="knob" material="abs">
      <difference>
        <chamfer distance={1.5} edges=">Z">
          <cylinder r={R} h={p.height} />
        </chamfer>
        {/* grip flutes around the side */}
        {p.grips > 0 && (
          <polarPattern count={p.grips} radius={R + 0.6}>
            <cylinder r={1.2} h={p.height} />
          </polarPattern>
        )}
        {/* pointer groove on top */}
        <box size={[1.6, R - 4, 1]} y={(R - 4) / 2 + 2} z={p.height - 0.8} />
        {/* D bore from below: a cylinder cut flat by a box */}
        <intersection>
          <cylinder r={r} h={p.depth} />
          <box size={[2 * r, r + flatAt, p.depth]} y={(flatAt - r) / 2} />
        </intersection>
      </difference>
    </part>
  )
}
