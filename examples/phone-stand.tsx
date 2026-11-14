/**
 * Desk phone stand: a side profile sketched as a polygon, extruded to width, with all the long
 * edges rounded, a cable pass-through slot and a lip that holds the phone at `angle`.
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  angle: { type: "number", default: 65, min: 45, max: 80, step: 1, unit: "°", label: "Lean angle" },
  width: { type: "number", default: 70, min: 40, max: 120, step: 1, unit: "mm", label: "Width" },
  phoneThickness: { type: "number", default: 11, min: 6, max: 20, step: 0.5, unit: "mm", label: "Phone + case" },
  backHeight: { type: "number", default: 90, min: 50, max: 160, step: 1, unit: "mm", label: "Back rest" },
  thickness: { type: "number", default: 6, min: 3, max: 12, step: 0.5, unit: "mm", label: "Thickness" },
  cableSlot: { type: "boolean", default: true, label: "Cable slot" },
})

export default function PhoneStand(p: ParamValues<typeof params>) {
  const t = p.thickness
  const a = (p.angle * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  // Side profile in the sketch plane (u = front-to-back, v = up). The back rest leans back at
  // `angle` from the horizontal; the lip in front holds the phone's bottom edge.
  const lipX = 12
  const slotW = p.phoneThickness
  const restX = lipX + t + slotW // where the back rest meets the base
  const top: [number, number] = [restX + p.backHeight * cos, p.backHeight * sin]
  const footX = Math.max(top[0] + 10, restX + 40)
  const profile: [number, number][] = [
    [0, 0],
    [footX, 0],
    [footX, t],
    // underside of the back rest, offset by the thickness
    [restX + t / sin + (p.backHeight * 0.45) * cos, (p.backHeight * 0.45) * sin],
    [top[0] + t / sin, top[1]],
    top,
    [restX, t],
    [lipX + t, t],
    [lipX + t, t + 14],
    [lipX, t + 14],
    [lipX, t],
    [0, t],
  ]

  return (
    <part name="stand" color="#6b8f71">
      <difference>
        <fillet radius={Math.min(2, t * 0.4)} edges={edges.parallel("y")}>
          {/* side profile sketched on the XZ plane, extruded symmetrically to width */}
          <extrude height={p.width} plane="XZ" center>
            <polygon points={profile} />
          </extrude>
        </fillet>
        {/* a notch through the lip and base for the charging cable */}
        {p.cableSlot && <box size={[restX - lipX + 4, 14, 40]} x={(lipX + restX) / 2} z={-10} />}
      </difference>
    </part>
  )
}
