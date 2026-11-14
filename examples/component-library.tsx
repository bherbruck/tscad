/**
 * "It's just React": a tiny library of reusable, typed function components — a standoff,
 * a countersunk hole, a rounded plate — composed into a Raspberry-Pi-style mounting plate.
 * Components take props, compute with plain TypeScript, map over arrays and return JSX.
 */
import { defineParams, edges, type ParamValues } from "tscad"

// ── the library ──────────────────────────────────────────────────────────────────────────────

type XY = { x?: number; y?: number; z?: number }

/** A round standoff with an optional pilot hole for a self-tapping screw. */
export function Standoff({ height, od = 6, pilot = 2.5, ...at }: { height: number; od?: number; pilot?: number } & XY) {
  return (
    <difference {...at}>
      <chamfer distance={0.5} edges={edges.top()}>
        <cylinder r={od / 2} h={height} />
      </chamfer>
      {pilot > 0 && <cylinder r={pilot / 2} h={height + 1} z={1} />}
    </difference>
  )
}

/** The negative volume of a countersunk screw hole, top at z = 0 pointing down. */
export function CountersunkHole({ d = 3.2, head = 6.5, depth = 20, ...at }: { d?: number; head?: number; depth?: number } & XY) {
  const sink = (head - d) / 2 // 90° countersink
  return (
    <union {...at}>
      <cylinder r={d / 2} h={depth} z={-depth} />
      <cone r1={d / 2} r2={head / 2} h={sink} z={-sink} />
      <cylinder r={head / 2} h={1} />
    </union>
  )
}

/** A flat plate with rounded vertical corners, lower corner at the origin. */
export function RoundedPlate({ w, d, t, r }: { w: number; d: number; t: number; r: number }) {
  return (
    <extrude height={t}>
      <roundedRect w={w} h={d} r={r} x={w / 2} y={d / 2} />
    </extrude>
  )
}

// ── the design ───────────────────────────────────────────────────────────────────────────────

/** Mounting-hole patterns of some common boards (mm, from the board's lower-left corner). */
const BOARDS = {
  "Raspberry Pi 4": { size: [85, 56], holes: [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]] },
  "Arduino Uno": { size: [68.6, 53.3], holes: [[14, 2.5], [15.3, 50.7], [66.1, 7.6], [66.1, 35.5]] },
  "ESP32 DevKit": { size: [55, 28], holes: [[2.5, 2.5], [52.5, 2.5], [2.5, 25.5], [52.5, 25.5]] },
} as const

export const params = defineParams({
  board: { type: "choice", default: "Raspberry Pi 4", options: Object.keys(BOARDS) as (keyof typeof BOARDS)[], label: "Board" },
  margin: { type: "number", default: 12, min: 6, max: 30, step: 1, unit: "mm", label: "Margin" },
  plate: { type: "number", default: 3, min: 2, max: 8, step: 0.5, unit: "mm", label: "Plate thickness" },
  standoff: { type: "number", default: 6, min: 3, max: 20, step: 0.5, unit: "mm", label: "Standoff height" },
  mountingHoles: { type: "boolean", default: true, label: "Wall-mount holes" },
})

export default function BoardMount(p: ParamValues<typeof params>) {
  const board = BOARDS[p.board]
  const [bw, bd] = board.size
  const W = bw + 2 * p.margin
  const D = bd + 2 * p.margin

  return (
    <part name="board-mount" color="#3d5a80">
      <difference>
        <union>
          <fillet radius={1} edges={edges.top()}>
            <RoundedPlate w={W} d={D} t={p.plate} r={5} />
          </fillet>
          {board.holes.map(([x, y]) => (
            <Standoff height={p.standoff} x={p.margin + x} y={p.margin + y} z={p.plate} />
          ))}
        </union>
        {p.mountingHoles &&
          [
            [p.margin / 2, p.margin / 2],
            [W - p.margin / 2, p.margin / 2],
            [p.margin / 2, D - p.margin / 2],
            [W - p.margin / 2, D - p.margin / 2],
          ].map(([x, y]) => <CountersunkHole x={x} y={y} z={p.plate} />)}
      </difference>
    </part>
  )
}
