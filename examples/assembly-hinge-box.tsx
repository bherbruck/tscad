/**
 * Hinged box: a shelled base and a lid joined by a revolute mate along the back edge.
 * The `open` param drives the hinge angle: drag it and the lid swings.
 *
 *   tscad dev examples/assembly-hinge-box.tsx
 */
import { assemblyRefs, defineParams, faces, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 80, min: 30, max: 200, step: 1, unit: "mm", label: "Width" },
  depth: { type: "number", default: 50, min: 20, max: 150, step: 1, unit: "mm", label: "Depth" },
  height: { type: "number", default: 30, min: 10, max: 100, step: 1, unit: "mm", label: "Height" },
  lid: { type: "number", default: 6, min: 2, max: 30, step: 0.5, unit: "mm", label: "Lid height" },
  wall: { type: "number", default: 2, min: 0.8, max: 5, step: 0.1, unit: "mm", label: "Wall" },
  open: { type: "number", default: 70, min: 0, max: 180, step: 1, unit: "°", label: "Lid open" },
})

// typed anchor handles: a typo such as A.lid.hinj doesn't compile
const A = assemblyRefs<{ base: "hinge"; lid: "hinge" }>()

export default function HingeBox(p: ParamValues<typeof params>) {
  const { width: w, depth: d, height: h, wall } = p
  return (
    <assembly>
      <part name={A.base.name} color="#5b7fa6" fixed>
        <shell thickness={wall} open={faces.top()}>
          <box size={[w, d, h]} />
        </shell>
        {/* hinge axis along X on the box's back top edge */}
        <anchor id="hinge" at={[0, d / 2, h]} axis="x" />
      </part>

      {/* the lid is modelled open-side down at the origin; its back bottom edge is the hinge */}
      <part name={A.lid.name} color="#c9a227">
        <shell thickness={wall} open={faces.bottom()}>
          <box size={[w, d, p.lid]} />
        </shell>
        <anchor id="hinge" at={[0, d / 2, 0]} axis="x" />
      </part>

      {/* rotating about +X lifts the front edge (−Y) up: negate to open */}
      <mate a={A.base.hinge} b={A.lid.hinge} type="revolute" angle={-p.open} limits={[-180, 0]} />
    </assembly>
  )
}
