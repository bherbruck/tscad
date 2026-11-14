/**
 * Link arm drawn as a constraint sketch: two bosses joined by lines tangent to both, a bore
 * in each boss and an adjustment slot between them. Nothing is computed by hand — the
 * outline's tangent points come out of the solver, and every dimension is a param.
 * Written with typed handles (`sketchRefs`) instead of string ids.
 *
 *   tscad dev examples/sketch-link-arm.tsx
 */
import { defineParams, edges, sketchRefs, type ParamValues, type PointHandle } from "tscad"

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
 * A stadium slot between centre points `a` and `b` (placed by the caller), `width` wide.
 * Its own handles are private to each copy, so a sketch can hold several slots.
 */
function Slot({ a, b, width }: { a: PointHandle; b: PointHandle; width: number }) {
  const s = sketchRefs<{ left: "arc"; right: "arc"; p1: "point"; p2: "point"; p3: "point"; p4: "point" }>()
  return (
    <>
      <arc ref={s.left} center={a} from={s.p1} to={s.p2} radius={width / 2} />
      <line from={s.p2} to={s.p3} tangent />
      <arc ref={s.right} center={b} from={s.p3} to={s.p4} tangent equal={s.left} />
      <line from={s.p4} to={s.p1} tangent={[s.right, s.left]} />
    </>
  )
}

export default function LinkArm(p: ParamValues<typeof params>) {
  const R1 = p.bigRadius, R2 = p.smallRadius
  // keep any slider combination buildable: rounds under half the thickness, walls around the
  // bores, the slot narrower than the arm and only when it fits between the bosses
  const round = Math.min(p.edgeRound, p.thickness * 0.4)
  const wall = Math.max(3, 2 * round + 1)
  const gap = Math.max(4, wall) // material between a boss's edge and the slot
  const bigBore = Math.min(p.bigBore, 2 * (R1 - wall))
  const smallBore = Math.min(p.smallBore, 2 * (R2 - wall))
  const L = Math.max(p.length, Math.abs(R1 - R2) + 2, bigBore / 2 + smallBore / 2 + wall)
  const slotWidth = Math.min(p.slotWidth, 2 * (Math.min(R1, R2) - wall))
  const slotFrom = R1 + gap + slotWidth / 2, slotTo = L - (R2 + gap + slotWidth / 2)
  const withSlot = slotWidth > 1 && slotTo - slotFrom > 1
  // typed handles: `tangent={s.c1}` (a point) would not compile
  const s = sketchRefs<{
    c1: "point"; c2: "point"; s1: "point"; s2: "point"
    big: "arc"; small: "arc"; lower: "line"; upper: "line"
  }>()
  return (
    <part name="link-arm" material="aluminum">
      <fillet radius={round} edges={edges.parallel("z").not()}>
        <extrude height={p.thickness}>
          <sketch>
            {/* the two boss centres */}
            <point ref={s.c1} x={0} y={0} fixed />
            <point ref={s.c2} x={L} y={0} />
            <horizontal a={s.c1} b={s.c2} />
            <dimension a={s.c1} b={s.c2} distance={L} />

            {/* outline: big end, lower tangent, small end, upper tangent */}
            <arc ref={s.big} center={s.c1} from={s.upper.end} to={s.lower.start} radius={R1} />
            <line ref={s.lower} from={s.big.end} to={s.small.start} tangent />
            <arc ref={s.small} center={s.c2} from={s.lower.end} to={s.upper.start} radius={R2} tangent={s.lower} />
            <line ref={s.upper} from={s.small.end} to={s.big.start} tangent={[s.small, s.big]} />

            {/* bores, concentric with the bosses */}
            {bigBore > 0.5 && <circle center={s.c1} diameter={bigBore} />}
            {smallBore > 0.5 && <circle center={s.c2} diameter={smallBore} />}

            {/* adjustment slot on the centre line, clear of both bosses */}
            {withSlot && (
              <>
                <point ref={s.s1} x={L / 3} y={0} />
                <point ref={s.s2} x={(2 * L) / 3} y={0} />
                <horizontal a={s.c1} b={s.s1} />
                <horizontal a={s.c1} b={s.s2} />
                <dimension a={s.c1} b={s.s1} dx={slotFrom} />
                <dimension a={s.s2} b={s.c2} dx={R2 + gap + slotWidth / 2} />
                <Slot a={s.s1} b={s.s2} width={slotWidth} />
              </>
            )}
          </sketch>
        </extrude>
      </fillet>
    </part>
  )
}
