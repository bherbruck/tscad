/**
 * L-shaped mounting bracket: a filleted base plate and upright joined by a gusset,
 * with a parametric grid of mounting holes in the base and a slot pair in the upright.
 *
 *   tscad dev examples/bracket.tsx
 *   tscad build examples/bracket.tsx -o bracket.step
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 60, min: 20, max: 160, step: 1, unit: "mm", label: "Width" },
  depth: { type: "number", default: 40, min: 20, max: 120, step: 1, unit: "mm", label: "Base depth" },
  height: { type: "number", default: 45, min: 20, max: 120, step: 1, unit: "mm", label: "Upright height" },
  thickness: { type: "number", default: 5, min: 2, max: 12, step: 0.5, unit: "mm", label: "Thickness" },
  holesX: { type: "int", default: 2, min: 1, max: 8, label: "Holes across" },
  holesY: { type: "int", default: 2, min: 1, max: 4, label: "Holes deep" },
  holeDiameter: { type: "number", default: 5.5, min: 2, max: 12, step: 0.1, unit: "mm", label: "Hole Ø" },
  gusset: { type: "boolean", default: true, label: "Gusset" },
  cornerRadius: { type: "number", default: 4, min: 0, max: 15, step: 0.5, unit: "mm", label: "Corner radius" },
})

export default function Bracket(p: ParamValues<typeof params>) {
  const t = p.thickness
  const d = p.holeDiameter
  // the inside-bend fillet, as big as the plate is thick but leaving flat on both legs
  const bend = Math.min(t, (p.depth - t) / 3, (p.height - t) / 3)
  // outer corners: no bigger than half the width or the flat part of each leg
  const corner = Math.max(0, Math.min(p.cornerRadius, p.width / 2 - 1, p.depth - t - bend - 1, p.height - t - bend - 1))
  const margin = Math.max(d, 6)
  // holes start past the bend fillet; drop rows/columns that would overlap (pitch ≥ 1.5 Ø)
  const y0 = t + Math.max(margin, bend + d / 2 + 1)
  const spanX = p.width - 2 * margin
  const spanY = p.depth - margin - y0
  const holesX = Math.max(1, Math.min(p.holesX, Math.floor(spanX / (1.5 * d)) + 1))
  const holesY = Math.max(1, Math.min(p.holesY, Math.floor(spanY / (1.5 * d)) + 1))
  const pitchX = holesX > 1 ? spanX / (holesX - 1) : 0
  const pitchY = holesY > 1 ? spanY / (holesY - 1) : 0
  const gussetSize = Math.min(p.depth, p.height) * 0.6
  // slots in the upright: centred at 60% height, clear of the bend fillet below
  const slotBottom = t + bend + 1
  const slotTop = p.height - Math.max(corner, 1) - 1
  const slotLength = Math.min(p.height * 0.3, slotTop - slotBottom - d)
  const slotZ = Math.min(Math.max(p.height * 0.6, slotBottom + (slotLength + d) / 2), slotTop - (slotLength + d) / 2)

  return (
    <part name="bracket" color="#4f7cac">
      <difference>
        <union>
          {/* round the outer corners: the base's front corners and the upright's top corners */}
          <fillet radius={corner} edges={edges.parallel("z").max("y").or(edges.parallel("y").max("z"))}>
            {/* a fillet in the inside bend, as wide as the plate */}
            <fillet radius={bend} edges={edges.parallel("x").within([-1, t - 0.01, t - 0.01], [p.width + 1, t + 0.01, t + 0.01])}>
              <union>
                {/* base plate (x: width, y: depth) */}
                <box size={[p.width, p.depth, t]} center={false} />
                {/* upright along the back edge */}
                <box size={[p.width, t, p.height]} center={false} />
              </union>
            </fillet>
          </fillet>
          {/* triangular gusset in the middle */}
          {p.gusset && (
            <extrude height={t} plane="YZ" x={p.width / 2 - t / 2}>
              <polygon points={[[0, 0], [gussetSize, 0], [0, gussetSize]]} />
            </extrude>
          )}
        </union>

        {/* mounting holes through the base */}
        <gridPattern nx={holesX} ny={holesY} dx={pitchX} dy={pitchY} center={false}>
          <cylinder r={d / 2} h={t * 3} x={margin} y={y0} z={-t} />
        </gridPattern>

        {/* two vertical adjustment slots through the upright */}
        {slotLength > 0 &&
          [0.25, 0.75].map((fx) => (
            <extrude height={t * 3} x={p.width * fx} y={-t} z={slotZ} rotate={[-90, 0, 0]}>
              <slot length={slotLength} width={d} rotate={90} />
            </extrude>
          ))}
      </difference>
    </part>
  )
}
