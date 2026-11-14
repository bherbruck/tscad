/**
 * Link arm drawn as a constraint sketch: two bosses joined by lines tangent to both, a bore
 * in each boss and an adjustment slot between them. Nothing is computed by hand — the
 * outline's tangent points come out of the solver, and every dimension is a param.
 *
 *   tscad dev examples/sketch-link-arm.tsx
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  length: { type: "number", default: 90, min: 50, max: 200, step: 1, unit: "mm", label: "Centre distance" },
  bigRadius: { type: "number", default: 16, min: 8, max: 40, step: 0.5, unit: "mm", label: "Big boss radius" },
  smallRadius: { type: "number", default: 10, min: 5, max: 30, step: 0.5, unit: "mm", label: "Small boss radius" },
  bigBore: { type: "number", default: 12, min: 3, max: 50, step: 0.5, unit: "mm", label: "Big bore Ø" },
  smallBore: { type: "number", default: 6, min: 2, max: 40, step: 0.5, unit: "mm", label: "Small bore Ø" },
  slotWidth: { type: "number", default: 6, min: 2, max: 20, step: 0.5, unit: "mm", label: "Slot width" },
  thickness: { type: "number", default: 6, min: 2, max: 20, step: 0.5, unit: "mm", label: "Thickness" },
  edgeRound: { type: "number", default: 1, min: 0, max: 3, step: 0.25, unit: "mm", label: "Edge round" },
})

/**
 * A stadium slot between points `a` and `b` (which the caller places), `width` wide.
 * Sketch components compose like any other: ids are prefixed so several can coexist.
 */
function Slot({ id, a, b, width }: { id: string; a: string; b: string; width: number }) {
  const r = width / 2
  return (
    <>
      <arc id={`${id}_l`} center={a} from={`${id}_1`} to={`${id}_2`} radius={r} />
      <line from={`${id}_2`} to={`${id}_3`} tangent />
      <arc id={`${id}_r`} center={b} from={`${id}_3`} to={`${id}_4`} tangent equal={`${id}_l`} />
      <line from={`${id}_4`} to={`${id}_1`} tangent={[`${id}_r`, `${id}_l`]} />
    </>
  )
}

export default function LinkArm(p: ParamValues<typeof params>) {
  const L = p.length, R1 = p.bigRadius, R2 = p.smallRadius
  const gap = 4 // material between a boss's edge and the slot
  return (
    <part name="link-arm" material="aluminum">
      <fillet radius={p.edgeRound} edges={edges.parallel("z").not()}>
        <extrude height={p.thickness}>
          <sketch>
            {/* the two boss centres */}
            <point id="c1" x={0} y={0} fixed />
            <point id="c2" x={L} y={0} />
            <horizontal a="c1" b="c2" />
            <dimension a="c1" b="c2" distance={L} />

            {/* outline: big end, lower tangent, small end, upper tangent */}
            <arc id="big" center="c1" from="t1" to="t4" radius={R1} />
            <line id="lower" from="t4" to="t2" tangent />
            <arc id="small" center="c2" from="t2" to="t3" radius={R2} tangent="lower" />
            <line id="upper" from="t3" to="t1" tangent={["small", "big"]} />

            {/* bores, concentric with the bosses */}
            <circle center="c1" diameter={p.bigBore} />
            <circle center="c2" diameter={p.smallBore} />

            {/* adjustment slot on the centre line, clear of both bosses */}
            <point id="s1" x={L / 3} y={0} />
            <point id="s2" x={(2 * L) / 3} y={0} />
            <horizontal a="c1" b="s1" />
            <horizontal a="c1" b="s2" />
            <dimension a="c1" b="s1" dx={R1 + gap + p.slotWidth / 2} />
            <dimension a="s2" b="c2" dx={R2 + gap + p.slotWidth / 2} />
            <Slot id="slot" a="s1" b="s2" width={p.slotWidth} />
          </sketch>
        </extrude>
      </fillet>
    </part>
  )
}
