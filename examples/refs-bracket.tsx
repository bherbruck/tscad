/**
 * Refs: a mounting plate built by naming solids and operating on them from outside. Two
 * library bolt cutters drill counterbored holes (`<subtract from tool>`), and the plate is
 * rounded by `<fillet target>` after the cuts, with no restructuring of the tree around it.
 */
import { defineParams, edges, type ParamValues } from "tscad"
import { Bolt } from "tscad/parts"

export const params = defineParams({
  width: { type: "number", default: 50, min: 30, max: 120, step: 1, unit: "mm", label: "Width" },
  depth: { type: "number", default: 24, min: 16, max: 60, step: 1, unit: "mm", label: "Depth" },
  thickness: { type: "number", default: 6, min: 4, max: 12, step: 0.5, unit: "mm", label: "Thickness" },
  thread: { type: "choice", default: "M4", options: ["M3", "M4", "M5"], label: "Bolt" },
  counterbore: { type: "number", default: 3, min: 0, max: 6, step: 0.5, unit: "mm", label: "Counterbore depth" },
  round: { type: "number", default: 1.5, min: 0, max: 3, step: 0.1, unit: "mm", label: "Outer edge round" },
})

export default function RefsBracket(p: ParamValues<typeof params>) {
  const inset = Math.min(p.width / 4, 12)
  // the head sits this far below the top face; at least 2 mm of plate stays under it
  const sink = Math.min(p.counterbore, p.thickness - 2)
  const length = Math.ceil(p.thickness + 2)
  const top = p.thickness - sink
  return (
    <part name="plate" material="petg">
      <box name="plate" size={[p.width, p.depth, p.thickness]} />
      {/* clearance cutters: a hole down the shank and a pocket for the head */}
      <Bolt name="left" cutter thread={p.thread} length={length} x={-p.width / 2 + inset} z={top} />
      <Bolt name="right" cutter thread={p.thread} length={length} x={p.width / 2 - inset} z={top} />
      <subtract from=".plate" tool=".left, .right" />
      {/* round the outline's top edges (not the holes) */}
      <fillet target=".plate" radius={p.round} edges={edges.max("z").parallel("x").or(edges.max("z").parallel("y"))} />
    </part>
  )
}
