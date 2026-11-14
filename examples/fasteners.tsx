/**
 * Standard hardware from `tscad/parts`: a bearing block bolted to a base plate. The plate gets
 * its holes from each bolt's own clearance cutter, the 608 bearing sits in a pocket, and a
 * shaft collar, washers and nyloc nuts complete the stack. Every size comes from ISO tables.
 *
 *   tscad dev examples/fasteners.tsx
 */
import { defineParams, type ParamValues } from "tscad"
import { Bearing, Bolt, Nut, ShaftCollar, Washer, bearings, flatWashers, type MetricSize } from "tscad/parts"

export const params = defineParams({
  thread: { type: "choice", default: "M4", options: ["M3", "M4", "M5", "M6"], label: "Bolts" },
  head: { type: "choice", default: "socket", options: ["socket", "button", "hex", "pan", "flat"], label: "Head" },
  plate: { type: "number", default: 8, min: 5, max: 15, step: 0.5, unit: "mm", label: "Plate" },
  exploded: { type: "number", default: 12, min: 0, max: 30, step: 1, unit: "mm", label: "Explode" },
})

export default function Fasteners(p: ParamValues<typeof params>) {
  const thread = p.thread as MetricSize
  const head = p.head as "socket" | "button" | "hex" | "pan" | "flat"
  const t = p.plate
  const b = bearings["608"]
  const W = 70, D = 40
  const holes: [number, number][] = [[-25, -12], [25, -12], [-25, 12], [25, 12]]
  const len = t + 8
  const e = p.exploded
  const wh = flatWashers[thread].h
  return (
    <assembly>
      <part name="plate" color="#4f6d8f">
        <difference>
          <box size={[W, D, t]} />
          {holes.map(([x, y]) => (
            <Bolt thread={thread} length={len} head={head} cutter x={x} y={y} z={t} />
          ))}
          {/* a press-fit pocket for the bearing and a through hole for the shaft */}
          <cylinder d={b.D + 0.1} h={b.B + 0.01} z={t - b.B} />
          <cylinder d={b.d + 2} h={t + 2} z={-1} />
        </difference>
      </part>

      <part name="bolts" color="#9aa3ad">
        {holes.map(([x, y]) => (
          <Bolt thread={thread} length={len} head={head} x={x} y={y} z={t + e} />
        ))}
      </part>

      <part name="washers" color="#c9ced4">
        {holes.map(([x, y]) => (
          <Washer thread={thread} x={x} y={y} z={-wh - e} />
        ))}
      </part>

      <part name="nuts" color="#d8b45a">
        {holes.map(([x, y]) => (
          // nyloc dome down, against the washer (flipped about X)
          <Nut thread={thread} type="nyloc" x={x} y={y} z={-wh - 2 * e} rotateX={180} />
        ))}
      </part>

      <part name="bearing" color="#b8c2cc">
        <Bearing designation="608" z={t - b.B + e * 1.5} />
      </part>

      <part name="collar" color="#3c4652">
        <ShaftCollar bore={8} z={t + 2 * e + 2} />
      </part>
    </assembly>
  )
}
