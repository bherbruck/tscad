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
  holesX: { type: "int", default: 3, min: 1, max: 8, label: "Holes across" },
  holesY: { type: "int", default: 2, min: 1, max: 4, label: "Holes deep" },
  holeDiameter: { type: "number", default: 5.5, min: 2, max: 12, step: 0.1, unit: "mm", label: "Hole Ø" },
  gusset: { type: "boolean", default: true, label: "Gusset" },
  cornerRadius: { type: "number", default: 4, min: 0, max: 15, step: 0.5, unit: "mm", label: "Corner radius" },
})

export default function Bracket(p: ParamValues<typeof params>) {
  const t = p.thickness
  const margin = Math.max(p.holeDiameter, 6)
  const pitchX = p.holesX > 1 ? (p.width - 2 * margin) / (p.holesX - 1) : 0
  const pitchY = p.holesY > 1 ? (p.depth - t - 2 * margin) / (p.holesY - 1) : 0
  const gussetSize = Math.min(p.depth, p.height) * 0.6

  return (
    <part name="bracket" color="#4f7cac">
      <difference>
        {/* round the outer corners: the base's front corners and the upright's top corners */}
        <fillet radius={p.cornerRadius} edges={edges.parallel("z").max("y").or(edges.parallel("y").max("z"))}>
          {/* a fillet in the inside bend, as wide as the plate */}
          <fillet radius={t} edges={edges.parallel("x").within([-1, t - 0.01, t - 0.01], [p.width + 1, t + 0.01, t + 0.01])}>
            <union>
            {/* base plate (x: width, y: depth) */}
            <box size={[p.width, p.depth, t]} center={false} />
            {/* upright along the back edge */}
            <box size={[p.width, t, p.height]} center={false} />
            {/* triangular gusset in the middle */}
            {p.gusset && (
              <extrude height={t} plane="YZ" x={p.width / 2 - t / 2}>
                <polygon points={[[0, 0], [gussetSize, 0], [0, gussetSize]]} />
              </extrude>
            )}
            </union>
          </fillet>
        </fillet>

        {/* mounting holes through the base */}
        <gridPattern nx={p.holesX} ny={p.holesY} dx={pitchX} dy={pitchY} center={false}>
          <cylinder r={p.holeDiameter / 2} h={t * 3} x={margin} y={t + margin} z={-t} />
        </gridPattern>

        {/* two vertical adjustment slots through the upright */}
        {[0.25, 0.75].map((fx) => (
          <extrude height={t * 3} x={p.width * fx} y={-t} z={p.height * 0.6} rotate={[-90, 0, 0]}>
            <slot length={p.height * 0.3} width={p.holeDiameter} rotate={90} />
          </extrude>
        ))}
      </difference>
    </part>
  )
}
