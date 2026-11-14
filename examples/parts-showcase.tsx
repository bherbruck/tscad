/**
 * The `tscad/parts` library in action: a NEMA 17 motor mount plate with counterbored M3
 * screws and a pilot bore, next to a Raspberry Pi 4 base with M2.5 standoffs, a nut trap
 * and an engraved label. Parts are just components — import them like any npm package.
 *
 *   tscad dev examples/parts-showcase.tsx
 */
import { defineParams, type ParamValues } from "tscad"
import { BoltPattern, CounterboreHole, Hole, mountPatterns, NutTrap, Standoff } from "tscad/parts"

export const params = defineParams({
  plate: { type: "number", default: 5, min: 3, max: 10, step: 0.5, unit: "mm", label: "Plate thickness" },
  standoff: { type: "number", default: 6, min: 3, max: 15, step: 0.5, unit: "mm", label: "Standoff height" },
  holeStyle: { type: "choice", default: "counterbore", options: ["counterbore", "plain"], label: "Motor screws" },
  label: { type: "text", default: "Pi 4", maxLength: 12, label: "Label" },
})

const nema = mountPatterns.nema17
const pi = mountPatterns.raspberryPi4

/** A square plate for a NEMA 17: pilot bore plus four M3 screws. */
function MotorPlate({ t, counterbore }: { t: number; counterbore: boolean }) {
  return (
    <difference>
      <box size={[nema.outline[0] + 8, nema.outline[1] + 8, t]} />
      <Hole size="M3" diameter={nema.pilot + 0.5} depth={t} z={t} />
      <BoltPattern pattern={nema} z={t}>
        {counterbore ? <CounterboreHole size="M3" depth={t} /> : <Hole size="M3" depth={t} />}
      </BoltPattern>
    </difference>
  )
}

/** A base for a Raspberry Pi 4 with standoffs at the board's holes. */
function PiBase({ t, h, label }: { t: number; h: number; label: string }) {
  const [w, d] = pi.outline
  return (
    <union>
      <difference>
        <box size={[w + 6, d + 6, t]} />
        {/* captive nuts from below for the board screws */}
        <BoltPattern pattern={pi} rotateX={180}>
          <NutTrap size="M2.5" boltDepth={t} />
        </BoltPattern>
        <extrude height={0.6} offset={t - 0.6}>
          <text size={7} align="center" valign="middle">{label}</text>
        </extrude>
      </difference>
      <BoltPattern pattern={pi} z={t}>
        <Standoff size="M2.5" height={h} hole="clearance" />
      </BoltPattern>
    </union>
  )
}

export default function PartsShowcase(p: ParamValues<typeof params>) {
  return (
    <assembly>
      <part name="motor-plate" material="petg">
        <MotorPlate t={p.plate} counterbore={p.holeStyle === "counterbore"} />
      </part>
      <part name="pi-base" material="pla" x={80}>
        <PiBase t={p.plate} h={p.standoff} label={p.label} />
      </part>
    </assembly>
  )
}
