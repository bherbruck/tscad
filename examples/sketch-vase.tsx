/**
 * Lofted vase: three constraint-sketched sections — a rounded square at the foot, a wider
 * belly, a narrow neck — skinned smoothly and hollowed out from the top.
 *
 *   tscad dev examples/sketch-vase.tsx
 */
import { defineParams, faces, type ParamValues } from "tscad"

export const params = defineParams({
  height: { type: "number", default: 120, min: 60, max: 250, step: 1, unit: "mm", label: "Height" },
  foot: { type: "number", default: 60, min: 30, max: 120, step: 1, unit: "mm", label: "Foot width" },
  belly: { type: "number", default: 90, min: 40, max: 160, step: 1, unit: "mm", label: "Belly width" },
  neck: { type: "number", default: 40, min: 20, max: 100, step: 1, unit: "mm", label: "Neck width" },
  roundness: { type: "number", default: 0.3, min: 0.05, max: 0.5, step: 0.01, label: "Corner roundness" },
  wall: { type: "number", default: 2.4, min: 1, max: 6, step: 0.1, unit: "mm", label: "Wall" },
})

/**
 * A w × w square with corners rounded to r, centred: four lines and four tangent arcs,
 * drawn once as a constraint sketch and reused for every section.
 */
function RoundedSquare({ w, r, z }: { w: number; r: number; z: number }) {
  return (
    <sketch z={z}>
      <point id="c" fixed />
      <line id="bottom" from="b0" to="b1" horizontal tangent />
      <arc id="se" from="b1" to="r0" tangent="bottom" radius={r} />
      <line id="right" from="r0" to="r1" vertical tangent />
      <arc id="ne" from="r1" to="t0" tangent="right" equal="se" />
      <line id="top" from="t0" to="t1" horizontal tangent />
      <arc id="nw" from="t1" to="l0" tangent="top" equal="se" />
      <line id="left" from="l0" to="l1" vertical tangent />
      <arc id="sw" from="l1" to="b0" tangent="left" equal="se" />
      <dimension a="b0" b="top" distance={w} />
      <dimension a="r0" b="left" distance={w} />
      <symmetric a="b0" b="t0" about="c" />
      {/* rough positions so the solver starts the right way round */}
      {([["b0", -1, -2], ["b1", 1, -2], ["r0", 2, -1], ["r1", 2, 1], ["t0", 1, 2], ["t1", -1, 2], ["l0", -2, 1], ["l1", -2, -1]] as const).map(([id, x, y]) => (
        <point id={id} x={(x * w) / 4} y={(y * w) / 4} />
      ))}
    </sketch>
  )
}

export default function Vase(p: ParamValues<typeof params>) {
  const r = (w: number) => w * p.roundness
  return (
    <part name="vase" color="#7c9cbf">
      <shell thickness={p.wall} open={faces.top()}>
        <loft>
          <RoundedSquare w={p.foot} r={r(p.foot)} z={0} />
          <RoundedSquare w={p.belly} r={r(p.belly)} z={p.height * 0.45} />
          <RoundedSquare w={p.neck} r={r(p.neck)} z={p.height} />
        </loft>
      </shell>
    </part>
  )
}
