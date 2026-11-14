/**
 * BoxWithLid: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "int", default: 60, min: 20, max: 200, step: 1, description: "Outer width", group: "Box" },
  depth: { type: "int", default: 40, min: 20, max: 200, description: "Outer depth", group: "Box" },
  height: { type: "number", default: 25, min: 10, max: 100, step: 0.5, group: "Box" },
  wall: { type: "number", default: 2, min: 1, max: 5, step: 0.1, group: "Box" },
  part: { type: "choice", default: "both", options: ["base", "lid", "both"], description: "Which part to print", group: "Lid" },
  lid_height: { type: "int", default: 6, min: 6, max: 20, group: "Lid" },
})

/** OpenSCAD module shell(w, d, h, t) */
function Shell({ w, d, h, t }: { w: number; d: number; h: number; t: number }) {
  return (
    <difference>
      <box size={[w, d, h]} center={false} />
      <translate by={[t, t, t]}><box size={[w - 2 * t, d - 2 * t, h]} center={false} /></translate>
    </difference>
  )
}

export default function BoxWithLid(p: ParamValues<typeof params>) {
  const { width, depth, height, wall, part, lid_height } = p
  const gap = 0.4
  /** OpenSCAD module lid() */
  function Lid() {
    const inset = wall + gap
    return (
      <translate by={[width + 10, 0, 0]}>
        <box size={[width, depth, wall]} center={false} />
        <translate by={[inset, inset, wall]}>
          <box size={[width - 2 * inset, depth - 2 * inset, lid_height - wall]} center={false} />
        </translate>
      </translate>
    )
  }
  return (
    <>
      {part !== "lid" ? <Shell w={width} d={depth} h={height} t={wall} /> : null}
      {part !== "base" ? <Lid /> : null}
    </>
  )
}
