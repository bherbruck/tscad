/**
 * Support-free shelf bracket: an L bracket printed on its side. The gusset is a 45° chamfer and
 * the screw holes are teardrops (a 45° roof instead of a flat ceiling), so nothing overhangs.
 * `printable-bracket.spec.tsx` proves it with `toBePrintable` at every corner of its params.
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  length: { type: "number", default: 60, min: 30, max: 120, step: 1, unit: "mm", label: "Arm length" },
  width: { type: "number", default: 20, min: 12, max: 40, step: 1, unit: "mm", label: "Width" },
  thickness: { type: "number", default: 5, min: 3, max: 10, step: 0.5, unit: "mm", label: "Thickness" },
  hole: { type: "number", default: 4.5, min: 3, max: 8, step: 0.1, unit: "mm", label: "Hole Ø" },
})

/** A teardrop hole profile (tip up): prints without support when the hole axis is horizontal. */
function Teardrop({ r, x, y }: { r: number; x: number; y: number }) {
  const s = r * Math.SQRT1_2
  return (
    <sketch x={x} y={y}>
      <circle r={r} />
      <polygon points={[[-s, s], [s, s], [0, r * Math.SQRT2]]} />
    </sketch>
  )
}

export default function PrintableBracket(p: ParamValues<typeof params>) {
  const { length: L, width: w, thickness: t } = p
  const r = p.hole / 2
  return (
    <part name="bracket" material="petg">
      <difference>
        <fillet radius={1} edges={edges.vertical()}>
          {/* the L profile with a 45° gusset, flat on the bed and extruded up by the width */}
          <extrude height={w}>
            <polygon points={[[0, 0], [L, 0], [L, t], [t + L * 0.4, t], [t, t + L * 0.4], [t, L], [0, L]]} />
          </extrude>
        </fillet>
        {/* screw holes through each arm, horizontal → teardrops (sketch y = up = Z) */}
        <extrude plane="XZ" height={t * 4} center>
          <Teardrop r={r} x={L * 0.75} y={w / 2} />
        </extrude>
        <extrude plane="YZ" height={t * 4} center>
          <Teardrop r={r} x={L * 0.75} y={w / 2} />
        </extrude>
      </difference>
    </part>
  )
}
