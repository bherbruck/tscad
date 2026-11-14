/**
 * Wall hook: a J profile drawn as SVG path data (lines and an exact arc), extruded, with
 * countersunk screw holes in the back plate. Print it on its side: no supports.
 */
import { defineParams, type ParamValues } from "tscad"
import { CountersinkHole } from "tscad/parts"

export const params = defineParams({
  reach: { type: "number", default: 35, min: 15, max: 80, step: 1, unit: "mm", label: "Reach" },
  height: { type: "number", default: 70, min: 40, max: 150, step: 1, unit: "mm", label: "Back height" },
  width: { type: "number", default: 18, min: 10, max: 40, step: 1, unit: "mm", label: "Width" },
  thickness: { type: "number", default: 5, min: 3, max: 10, step: 0.5, unit: "mm", label: "Thickness" },
})

export default function WallHook(p: ParamValues<typeof params>) {
  const t = p.thickness
  const R = p.reach / 2 // outer radius of the bend
  const tip = 14 // the upturned tip's height
  // side profile, sketch x = out from the wall (X), sketch y = up (Z):
  // down the wall face, the outer bend, up the tip, back down, the inner bend, up the plate
  const d = `M0 ${p.height} V${R} A${R} ${R} 0 0 1 ${2 * R} ${R} V${R + tip} H${2 * R - t} V${R} A${R - t} ${R - t} 0 0 0 ${t} ${R} V${p.height} Z`
  return (
    <part name="hook" material="pla">
      <difference>
        <fillet radius={1} edges="|Y">
          <extrude height={p.width} plane="XZ" center>
            <path d={d} />
          </extrude>
        </fillet>
        {/* screws from the front into the wall: countersinks on the plate's front face */}
        {[0.6, 0.88].map((f, i) => (
          <CountersinkHole key={i} size="M4" depth={t} rotateY={90} at={[t, 0, f * p.height]} />
        ))}
      </difference>
    </part>
  )
}
