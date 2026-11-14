/**
 * Raspberry Pi 5 case: a base with M2.5 standoffs on the Pi's 58 × 49 mm pattern and cut-outs for USB-C, two micro-HDMI and the USB/Ethernet stack; a lid with vent slots and a GPIO slot.
 *
 * Brief: "a Raspberry Pi 5 case with vents and a GPIO slot"
 * Designed by an agent through the tscad MCP server (see docs/mcp-dogfood.md).
 */
import { defineParams, edges, faces, type ParamValues } from "tscad"
import { BoltPattern, mountPatterns, Standoff } from "tscad/parts"

export const params = defineParams({
  wall: { type: "number", default: 2, min: 1.2, max: 4, step: 0.1, unit: "mm", label: "Wall" },
  clearance: { type: "number", default: 2, min: 0.5, max: 6, step: 0.5, unit: "mm", label: "Board clearance" },
  height: { type: "number", default: 34, min: 30, max: 60, step: 1, unit: "mm", label: "Inside height" },
  vents: { type: "int", default: 7, min: 0, max: 15, label: "Vent slots" },
  exploded: { type: "boolean", default: true, label: "Exploded" },
})

const pi = mountPatterns.raspberryPi4 // same 58 × 49 mm pattern and 85 × 56 mm board on the Pi 5
const STANDOFF = 5

export default function Pi5Case(p: ParamValues<typeof params>) {
  const [bw, bd] = pi.outline
  const iw = bw + 2 * p.clearance, id = bd + 2 * p.clearance
  const W = iw + 2 * p.wall, D = id + 2 * p.wall
  const split = p.wall + STANDOFF + 1.5 + 17 // base height: the board and the tallest port (USB/Ethernet) sit in the base
  const top = p.wall + p.height
  // board centre offset from the pattern centre (the holes aren't centred on the board)
  const [ox, oy] = pi.outlineOffset
  const bx = ox + bw / 2, by = oy + bd / 2 // board centre in pattern coordinates
  const port = (x: number, w: number, h: number) => <box size={[w, p.wall * 3, h]} x={x} y={-D / 2} z={p.wall + STANDOFF + 1.5} />
  return (
    <assembly>
      <part name="base" material="pla">
        <difference>
          <fillet radius={3} edges={edges.vertical()}>
            <box size={[W, D, split]} />
          </fillet>
          <box size={[iw, id, split]} z={p.wall} />
          {/* ports on the front long edge: USB-C power + two micro-HDMI (Pi 5 positions from the board's left edge) */}
          {port(-bw / 2 + 11.2, 10, 4.5)}
          {port(-bw / 2 + 25.8, 8, 4.5)}
          {port(-bw / 2 + 39.2, 8, 4.5)}
          {/* USB + Ethernet stack on the right short edge */}
          <box size={[p.wall * 3, 50, 16]} x={W / 2} z={p.wall + STANDOFF + 1.5} />
        </difference>
        <BoltPattern pattern={pi} x={-bx} y={-by} z={p.wall}>
          <Standoff size="M2.5" height={STANDOFF} />
        </BoltPattern>
      </part>
      <part name="lid" material="pla" z={p.exploded ? split + 25 : split}>
        <difference>
          <fillet radius={3} edges={edges.vertical()}>
            <box size={[W, D, top - split]} />
          </fillet>
          <box size={[iw, id, top - split - p.wall]} />
          {/* GPIO header slot along the back edge */}
          <box size={[52, 7, p.wall * 3]} x={-bw / 2 + 32.5} y={bd / 2 - 3.5} z={top - split - p.wall * 2} />
          {/* vent slots over the SoC */}
          <linearPattern count={p.vents} dx={5} center>
            <box size={[2, 30, p.wall * 3]} y={-6} z={top - split - p.wall * 2} />
          </linearPattern>
        </difference>
      </part>
    </assembly>
  )
}
