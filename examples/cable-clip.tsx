/**
 * Cable clip: a C-shaped clip that snaps over a cable, with a screw tab. One extruded sketch:
 * the ring and the tab are disjoint outlines that meet, so they're cut and joined in one go.
 */
import { defineParams, type ParamValues } from "tscad"
import { CountersinkHole } from "tscad/parts"

export const params = defineParams({
  cable: { type: "number", default: 8, min: 3, max: 25, step: 0.5, unit: "mm", label: "Cable Ø" },
  wall: { type: "number", default: 2, min: 1.2, max: 4, step: 0.1, unit: "mm", label: "Wall" },
  width: { type: "number", default: 10, min: 5, max: 30, step: 1, unit: "mm", label: "Width" },
  opening: { type: "number", default: 0.75, min: 0.5, max: 0.95, step: 0.05, label: "Opening (× Ø)" },
})

export default function CableClip(p: ParamValues<typeof params>) {
  const r = p.cable / 2
  const R = r + p.wall
  const tab = 12
  // The opening's floor sits 0.4 r above the centre; a wider opening than where the bore meets
  // that floor (less the 0.6 mm round) would leave a sliver of jaw too thin to round.
  const maxHalf = Math.sqrt(Math.max(0, r * r - (r * 0.4 + 0.6) ** 2))
  const opening = Math.min(p.cable * p.opening, 2 * maxHalf)
  return (
    <part name="clip" material="petg">
      <fillet radius={0.6} edges="|Y">
        <difference>
          <union>
            <cylinder r={R} h={p.width} rotateX={90} y={p.width / 2} z={R} />
            <box size={[tab * 2 + 2 * R, p.width, p.wall]} />
          </union>
          {/* the cable */}
          <cylinder r={r} h={p.width + 2} rotateX={90} y={p.width / 2 + 1} z={R} />
          {/* the snap opening at the top */}
          <box size={[opening, p.width + 2, R]} z={R + r * 0.4} />
          <CountersinkHole size="M3" depth={p.wall} x={R + tab / 2} z={p.wall} />
          <CountersinkHole size="M3" depth={p.wall} x={-R - tab / 2} z={p.wall} />
        </difference>
      </fillet>
    </part>
  )
}
