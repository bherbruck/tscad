/**
 * Raspberry Pi 5 case, generated from the board's data: standoffs on its mounting holes, an
 * opening wherever a connector faces a wall (with plug clearance and a chamfer), and a vented
 * lid with a GPIO slot. The board is mated onto the standoffs, so `tscad_check` interference
 * proves it fits. Swap `board` for a Pi 4, Zero 2 W, Pico, Arduino Uno or ESP32-DevKitC.
 *
 *   tscad dev examples/pi5-case-auto.tsx
 */
import { defineParams, type ParamValues } from "tscad"
import { BoardCase, boards } from "tscad/parts"

export const params = defineParams({
  board: { type: "choice", default: "raspberryPi5", options: ["raspberryPi5", "raspberryPi4", "raspberryPiZero2W", "pico", "arduinoUno", "esp32DevKitC"], label: "Board" },
  wall: { type: "number", default: 2, min: 1.2, max: 4, step: 0.1, unit: "mm", label: "Wall" },
  clearance: { type: "number", default: 1, min: 0.3, max: 4, step: 0.1, unit: "mm", label: "Clearance" },
  gpio: { type: "boolean", default: true, label: "GPIO slot in the lid" },
  vents: { type: "boolean", default: true, label: "Vents" },
  explode: { type: "number", default: 30, min: 0, max: 80, step: 1, unit: "mm", label: "Lift the lid" },
})

export default function AutoCase(p: ParamValues<typeof params>) {
  const board = boards[p.board]
  // every connector that faces a wall, plus the GPIO header through the lid when asked
  const sides = board.connectors.filter((c) => c.facing !== "+z" && c.facing !== "-z").map((c) => c.id)
  const ports = p.gpio && board.connectors.some((c) => c.id === "gpio") ? [...sides, "gpio"] : sides
  return <BoardCase board={board} wall={p.wall} clearance={p.clearance} vents={p.vents} ports={ports} explode={p.explode} />
}
