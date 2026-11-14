/**
 * Honeycomb coaster: a round puck with a raised rim, a field of hexagonal pockets made with a
 * staggered gridPattern, clipped to a circle, and a filleted top edge.
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  diameter: { type: "number", default: 100, min: 60, max: 160, step: 1, unit: "mm", label: "Diameter" },
  thickness: { type: "number", default: 6, min: 3, max: 15, step: 0.5, unit: "mm", label: "Thickness" },
  cell: { type: "number", default: 10, min: 5, max: 25, step: 0.5, unit: "mm", label: "Cell size" },
  web: { type: "number", default: 1.6, min: 0.8, max: 5, step: 0.1, unit: "mm", label: "Web" },
  depth: { type: "number", default: 2.5, min: 0.5, max: 10, step: 0.1, unit: "mm", label: "Pocket depth" },
  rim: { type: "number", default: 5, min: 2, max: 15, step: 0.5, unit: "mm", label: "Rim width" },
})

export default function Coaster(p: ParamValues<typeof params>) {
  const R = p.diameter / 2
  const inner = R - p.rim
  const pitch = p.cell + p.web // flat-to-flat pitch between neighbouring cells
  const cols = Math.ceil((2 * inner) / (pitch * Math.sqrt(3))) + 1
  const rows = Math.ceil((2 * inner) / pitch) + 1

  // Two interleaved rectangular grids (each centred on the origin) make the honeycomb.
  const cells = (dx: number, dy: number) => (
    <gridPattern nx={cols} ny={rows} dx={pitch * Math.sqrt(3)} dy={pitch}>
      <extrude height={p.depth + 1} x={dx} y={dy} z={p.thickness - p.depth}>
        <regularPolygon sides={6} flats={p.cell} />
      </extrude>
    </gridPattern>
  )

  return (
    <part name="coaster" color="#d9a066">
      <difference>
        <fillet radius={1} edges={edges.max("z")}>
          <cylinder r={R} h={p.thickness} />
        </fillet>
        {/* the honeycomb, clipped to the area inside the rim */}
        <intersection>
          <union>
            {cells(0, 0)}
            {cells((pitch * Math.sqrt(3)) / 2, pitch / 2)}
          </union>
          <cylinder r={inner} h={p.thickness * 2} />
        </intersection>
      </difference>
    </part>
  )
}
