/**
 * Electronics enclosure: a rounded tub with screw bosses in each corner, vent louvres and
 * countersunk screws in the lid, and a USB-C cut-out: an assembly of two parts (body + lid).
 * Set `exploded` to lift the lid off for printing / inspection.
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 80, min: 40, max: 200, step: 1, unit: "mm", label: "Inner width" },
  depth: { type: "number", default: 55, min: 30, max: 160, step: 1, unit: "mm", label: "Inner depth" },
  height: { type: "number", default: 28, min: 12, max: 100, step: 1, unit: "mm", label: "Inner height" },
  wall: { type: "number", default: 2, min: 1.2, max: 5, step: 0.1, unit: "mm", label: "Wall" },
  radius: { type: "number", default: 4, min: 0, max: 15, step: 0.5, unit: "mm", label: "Corner radius" },
  vents: { type: "int", default: 6, min: 0, max: 12, label: "Vent louvres" },
  usb: { type: "boolean", default: true, label: "USB-C cut-out" },
  exploded: { type: "boolean", default: true, label: "Exploded" },
})

/**
 * A screw boss for a self-tapping M3 screw. `<Boss/>` is the post; `<Boss pilot/>` is the
 * matching pilot hole, so all the holes can be drilled in a single cut.
 */
function Boss({ x, y, height, z = 0, pilot = false }: { x: number; y: number; height: number; z?: number; pilot?: boolean }) {
  return pilot ? <cylinder r={1.25} h={height} x={x} y={y} z={z + 2} /> : <cylinder r={3.5} h={height} x={x} y={y} z={z} />
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
  const ventL = p.width * 0.55 // louvre length
  const ventPitch = Math.min(5, (p.depth - 10) / Math.max(1, p.vents))

  return (
    <assembly name="enclosure">
      <part name="body" color="#2d3640">
        <difference>
          <union>
            {/* a rounded tub: the outer outline minus the inner one, raised by the floor */}
            <difference>
              {/* the bottom round can't be bigger than the corner radius it runs into */}
              <fillet radius={Math.min(2, p.wall, p.radius > 0 ? p.radius * 0.9 : 2)} edges={edges.bottom()}>
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
          {/* every cut in one tool: the pilot holes and the USB-C opening */}
          <union>
            {corners.map(([x, y]) => (
              <Boss pilot x={x} y={y} height={H - p.wall - 1} z={p.wall / 2} />
            ))}
            {p.usb && (
              <extrude height={p.wall * 3} y={-p.wall} x={W / 2} z={p.wall + 6} rotate={[-90, 0, 0]}>
                <roundedRect w={9.5} h={3.5} r={1.6} />
              </extrude>
            )}
          </union>
        </difference>
      </part>

      <part name="lid" color="#e8edf2" z={p.exploded ? H + 15 : H}>
        <difference>
          <fillet radius={lidT * 0.5} edges={edges.top()}>
            <extrude height={lidT} x={W / 2} y={D / 2}>
              <roundedRect w={W} h={D} r={p.radius} />
            </extrude>
          </fillet>
          {/* every cut in one tool: the vent louvres plus four countersunk screw holes */}
          <union>
            {p.vents > 0 && (
              <extrude height={lidT * 3} x={W / 2} y={D / 2} z={-lidT}>
                {Array.from({ length: p.vents }, (_, i) => (
                  <slot length={ventL} width={2.4} y={(i - (p.vents - 1) / 2) * ventPitch} />
                ))}
              </extrude>
            )}
            {/* countersunk holes: one revolved profile each (shank, then a 90° cone) */}
            {corners.map(([x, y]) => (
              <revolve x={x} y={y}>
                <polygon points={[[0, -lidT], [1.7, -lidT], [1.7, lidT - 1.7], [4.7, lidT + 1.3], [0, lidT + 1.3]]} />
              </revolve>
            ))}
          </union>
        </difference>
      </part>
    </assembly>
  )
}
