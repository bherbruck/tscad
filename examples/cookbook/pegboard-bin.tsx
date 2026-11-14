/**
 * Pegboard bin: a row of compartments that hangs on standard 1" (25.4 mm) pegboard. A
 * `gridPattern` cuts the compartments, hooks sit at the pegboard pitch, and `tscad/parts`
 * adds a screw hole for fixing it to a wall instead.
 */
import { defineParams, edges, type ParamValues } from "tscad"
import { Hole } from "tscad/parts"

export const params = defineParams({
  columns: { type: "int", default: 3, min: 1, max: 8, label: "Compartments" },
  cell: { type: "number", default: 30, min: 15, max: 80, step: 1, unit: "mm", label: "Compartment size" },
  height: { type: "number", default: 35, min: 15, max: 100, step: 1, unit: "mm", label: "Height" },
  wall: { type: "number", default: 1.6, min: 1, max: 4, step: 0.1, unit: "mm", label: "Wall" },
})

const PITCH = 25.4 // pegboard hole spacing
const PEG = 5.5 // hook diameter (fits 6 mm holes)

export default function PegboardBin(p: ParamValues<typeof params>) {
  const w = p.columns * p.cell + p.wall
  const d = p.cell + p.wall
  const hooks = Math.max(1, Math.floor((w - 10) / PITCH) + 1)
  return (
    <part name="bin" material="petg">
      <union>
        <fillet radius={1} edges={edges.vertical()}>
          <difference>
            <box size={[w, d, p.height]} />
            <gridPattern nx={p.columns} ny={1} dx={p.cell} dy={0}>
              <box size={[p.cell - p.wall, p.cell - p.wall, p.height]} z={p.wall} />
            </gridPattern>
          </difference>
        </fillet>
        {/* back plate with hooks into the pegboard */}
        <difference>
          <box size={[w, 3, p.height + 12]} y={d / 2 + 1.5} />
          <Hole size="M4" depth={3} rotateX={90} at={[0, d / 2 + 3, p.height + 6]} />
        </difference>
        <linearPattern count={hooks} dx={PITCH} center>
          {/* an L hook: out through the board (6 mm), then up */}
          <cylinder d={PEG} h={9} rotateX={-90} y={d / 2 + 3} z={p.height + 6 - PITCH} />
          <cylinder d={PEG} h={8} y={d / 2 + 3 + 9 - PEG / 2} z={p.height + 6 - PITCH} />
        </linearPattern>
      </union>
    </part>
  )
}
