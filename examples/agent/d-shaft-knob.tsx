/**
 * Replacement knob for a 6 mm D-shaft: a fluted grip, a pointer groove, and a D bore with a fit clearance.
 * The fluted outline and the D are exact 2D booleans (`<difference2d>`), so the body is one
 * extrude and the bore another, instead of 26 solid cuts.
 *
 * Brief: "a replacement knob for a 6 mm D-shaft"
 * Designed by an agent through the tscad MCP server (see docs/mcp-dogfood.md).
 */
import { defineParams, type ParamValues } from "tscad"

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
  // the fluted rim and the D bore are 2D booleans: one extrude each instead of 24 + 2 solid cuts
  const rim = (
    <difference2d>
      <circle r={R} />
      {Array.from({ length: p.grips }, (_, i) => {
        const a = (i * 2 * Math.PI) / p.grips
        return <circle key={i} r={1.2} x={(R + 0.6) * Math.cos(a)} y={(R + 0.6) * Math.sin(a)} />
      })}
    </difference2d>
  )
  const dBore = (
    <difference2d>
      <circle r={r} />
      <rect w={2 * r + 1} h={r} y={flatAt + r / 2} />
    </difference2d>
  )
  return (
    <part name="knob" material="abs">
      <difference>
        {/* the fluted body, with the top edge chamfered (a chamfered cylinder clips it) */}
        <intersection>
          <extrude height={p.height}>{rim}</extrude>
          <chamfer distance={1.5} edges=">Z">
            <cylinder r={R + 1} h={p.height} />
          </chamfer>
        </intersection>
        {/* the D bore from below, and the pointer groove on top */}
        <extrude height={p.depth}>{dBore}</extrude>
        <box size={[1.6, R - 4, 1]} y={(R - 4) / 2 + 2} z={p.height - 0.8} />
      </difference>
    </part>
  )
}
