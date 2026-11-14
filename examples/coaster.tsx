/**
 * Honeycomb coaster: a round puck with a raised rim, a field of hexagonal pockets laid out on
 * a staggered grid (only the cells that fit inside the rim), and a filleted top edge.
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
  const hexR = p.cell / Math.sqrt(3) // circumradius of one cell
  const n = Math.ceil(inner / pitch) + 1

  // Honeycomb centres: rows `pitch` apart, every other column shifted by half a pitch.
  // Keep only the cells that fit entirely inside the rim; it's just an array filter.
  const centres: [number, number][] = []
  for (let i = -2 * n; i <= 2 * n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = (i * pitch * Math.sqrt(3)) / 2
      const y = j * pitch + (i % 2 ? pitch / 2 : 0)
      if (Math.hypot(x, y) + hexR <= inner) centres.push([x, y])
    }
  }

  return (
    <part name="coaster" color="#d9a066">
      <difference>
        <fillet radius={1} edges={edges.top()}>
          <cylinder r={R} h={p.thickness} />
        </fillet>
        {/* every pocket in one sketch, so the whole honeycomb is a single cut */}
        <extrude height={p.depth + 1} z={p.thickness - p.depth}>
          {centres.map(([x, y]) => (
            <regularPolygon sides={6} flats={p.cell} x={x} y={y} />
          ))}
        </extrude>
      </difference>
    </part>
  )
}
