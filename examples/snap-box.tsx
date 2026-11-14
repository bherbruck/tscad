/**
 * Snap-fit box: a rounded tub and a lid whose lip carries a snap bead that clicks into a groove
 * inside the rim. The lid is placed by a fastened mate (lid seated on the rim); set `exploded`
 * to lift it off. Clearances come from `<offset>` on one shared outline.
 */
import { assemblyRefs, defineParams, faces, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 70, min: 30, max: 160, step: 1, unit: "mm", label: "Width" },
  depth: { type: "number", default: 45, min: 25, max: 120, step: 1, unit: "mm", label: "Depth" },
  height: { type: "number", default: 30, min: 12, max: 100, step: 1, unit: "mm", label: "Height" },
  radius: { type: "number", default: 8, min: 2, max: 20, step: 0.5, unit: "mm", label: "Corner radius" },
  clearance: { type: "number", default: 0.2, min: 0, max: 0.6, step: 0.05, unit: "mm", label: "Fit clearance" },
  exploded: { type: "boolean", default: true, label: "Exploded" },
})

const WALL = 1.6
const LIP = 5 // lip depth into the tub
const BEAD = 0.6 // snap bead / groove size

const A = assemblyRefs<{ tub: "rim"; lid: "seat" }>()

export default function SnapBox(p: ParamValues<typeof params>) {
  const outline = (grow = 0) => <offset distance={grow}><roundedRect w={p.width} h={p.depth} r={p.radius} /></offset>
  const inner = -WALL // the tub's inside wall
  const lip = inner - p.clearance // the lid lip's outside
  return (
    <assembly>
      <part name={A.tub.name} color="#4f7cac" fixed>
        <difference>
          <extrude height={p.height}>{outline()}</extrude>
          {/* cavity (open top), floor 1.6 mm */}
          <extrude height={p.height} offset={WALL}>{outline(inner)}</extrude>
          {/* snap groove just below the rim */}
          <extrude height={BEAD * 2} offset={p.height - LIP / 2 - BEAD}>
            {outline(inner + BEAD)}
          </extrude>
        </difference>
        <anchor id="rim" at={[0, 0, p.height]} />
      </part>
      <part name={A.lid.name} color="#e9edf3">
        {/* top plate */}
        <extrude height={WALL}>{outline()}</extrude>
        {/* lip: a ring hanging down into the tub, with a bead that lands in the groove */}
        <extrude height={-LIP}>
          {outline(lip)}
          {outline(lip - 1.2)}
        </extrude>
        <extrude height={BEAD * 1.6} offset={-LIP / 2 - BEAD * 0.8}>
          {outline(lip + BEAD - p.clearance)}
          {outline(lip - 0.6)}
        </extrude>
        <anchor id="seat" at={[0, 0, 0]} />
      </part>
      <mate a={A.tub.rim} b={A.lid.seat} type="fastened" offset={p.exploded ? p.height * 0.8 : 0} />
    </assembly>
  )
}
