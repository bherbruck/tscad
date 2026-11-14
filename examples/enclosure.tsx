/**
 * Electronics enclosure: a rounded tub with screw bosses in each corner, a grid of vent slots
 * in the lid and a USB cut-out — modelled as an assembly of two parts (body + lid).
 * Set `exploded` to lift the lid off for printing / inspection.
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 80, min: 40, max: 200, step: 1, unit: "mm", label: "Inner width" },
  depth: { type: "number", default: 55, min: 30, max: 160, step: 1, unit: "mm", label: "Inner depth" },
  height: { type: "number", default: 28, min: 12, max: 100, step: 1, unit: "mm", label: "Inner height" },
  wall: { type: "number", default: 2, min: 1.2, max: 5, step: 0.1, unit: "mm", label: "Wall" },
  radius: { type: "number", default: 4, min: 0, max: 15, step: 0.5, unit: "mm", label: "Corner radius" },
  ventRows: { type: "int", default: 3, min: 0, max: 10, label: "Vent rows" },
  ventCols: { type: "int", default: 5, min: 1, max: 16, label: "Vent columns" },
  usb: { type: "boolean", default: true, label: "USB-C cut-out" },
  exploded: { type: "boolean", default: true, label: "Exploded" },
})

/** A screw boss: a post with a pilot hole for a self-tapping M3 screw. */
function Boss({ x, y, height, z = 0 }: { x: number; y: number; height: number; z?: number }) {
  return (
    <difference>
      <cylinder r={3.5} h={height} x={x} y={y} z={z} />
      <cylinder r={1.25} h={height} x={x} y={y} z={z + 2} />
    </difference>
  )
}

export default function Enclosure(p: ParamValues<typeof params>) {
  const W = p.width + 2 * p.wall
  const D = p.depth + 2 * p.wall
  const H = p.height + p.wall
  const lidT = p.wall * 1.5
  const inset = p.wall + 3 // boss centre from the outside corner (bosses merge into the walls)
  const corners: [number, number][] = [
    [inset, inset],
    [W - inset, inset],
    [inset, D - inset],
    [W - inset, D - inset],
  ]
  const slotL = (p.width * 0.6) / p.ventCols - 2
  const ventPitchX = (p.width * 0.6) / p.ventCols
  const ventPitchY = 5

  return (
    <assembly name="enclosure">
      <part name="body" color="#2d3640">
        <difference>
          <union>
            {/* a rounded tub: the outer outline minus the inner one, raised by the floor */}
            <difference>
              <fillet radius={Math.min(2, p.wall)} edges={edges.bottom()}>
                <extrude height={H} x={W / 2} y={D / 2}>
                  <roundedRect w={W} h={D} r={p.radius} />
                </extrude>
              </fillet>
              <extrude height={H} x={W / 2} y={D / 2} z={p.wall}>
                <roundedRect w={p.width} h={p.depth} r={Math.max(0.5, p.radius - p.wall)} />
              </extrude>
            </difference>
            {corners.map(([x, y]) => (
              <Boss x={x} y={y} height={H - p.wall - 1} z={p.wall / 2} />
            ))}
          </union>
          {p.usb && (
            <extrude height={p.wall * 3} y={-p.wall} x={W / 2} z={p.wall + 6} rotate={[-90, 0, 0]}>
              <roundedRect w={9.5} h={3.5} r={1.6} />
            </extrude>
          )}
        </difference>
      </part>

      <part name="lid" color="#e8edf2" z={p.exploded ? H + 15 : H}>
        <difference>
          <fillet radius={lidT * 0.5} edges={edges.top()}>
            <extrude height={lidT} x={W / 2} y={D / 2}>
              <roundedRect w={W} h={D} r={p.radius} />
            </extrude>
          </fillet>
          {/* vent slots: one extrusion of a whole grid of slot outlines, cut in one go */}
          {p.ventRows > 0 && (
            <extrude height={lidT * 3} x={W / 2} y={D / 2} z={-lidT}>
              {Array.from({ length: p.ventCols * p.ventRows }, (_, i) => (
                <slot
                  length={slotL}
                  width={2}
                  x={((i % p.ventCols) - (p.ventCols - 1) / 2) * ventPitchX}
                  y={(Math.floor(i / p.ventCols) - (p.ventRows - 1) / 2) * ventPitchY}
                />
              ))}
            </extrude>
          )}
          {/* countersunk screw holes over the bosses */}
          {corners.map(([x, y]) => (
            <union>
              <cylinder r={1.7} h={lidT * 3} x={x} y={y} z={-lidT} />
              <cone r1={1.7} r2={3.4} h={1.7} x={x} y={y} z={lidT - 1.7 + 0.001} />
            </union>
          ))}
        </difference>
      </part>
    </assembly>
  )
}
