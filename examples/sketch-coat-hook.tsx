/**
 * Coat hook: a rounded wall plate with two countersunk screw holes, and a round rod swept
 * along a constraint-sketched path — straight out from the wall, a tangent bend upwards, a
 * straight tip. The path is drawn in the YZ plane; the rod's profile is placed square to the
 * path's start automatically.
 *
 *   tscad dev examples/sketch-coat-hook.tsx
 */
import { defineParams, sketchRefs, type ParamValues } from "tscad"

export const params = defineParams({
  rod: { type: "number", default: 8, min: 4, max: 16, step: 0.5, unit: "mm", label: "Rod Ø" },
  reach: { type: "number", default: 35, min: 10, max: 80, step: 1, unit: "mm", label: "Reach" },
  bend: { type: "number", default: 14, min: 6, max: 40, step: 1, unit: "mm", label: "Bend radius" },
  rise: { type: "number", default: 18, min: 0, max: 60, step: 1, unit: "mm", label: "Tip rise" },
  tilt: { type: "number", default: 75, min: 30, max: 90, step: 1, unit: "°", label: "Tip angle" },
  plate: { type: "number", default: 70, min: 40, max: 140, step: 1, unit: "mm", label: "Plate height" },
  thickness: { type: "number", default: 6, min: 3, max: 12, step: 0.5, unit: "mm", label: "Plate thickness" },
})

/** The hook's centre line in YZ: out from the wall, a tangent bend, the tip. */
function HookPath({ z, reach, bend, rise, tilt }: { z: number; reach: number; bend: number; rise: number; tilt: number }) {
  const s = sketchRefs<{ start: "point"; out: "line"; curl: "arc" }>()
  return (
    <sketch>
      <point ref={s.start} x={0} y={z} fixed />
      <line ref={s.out} from={s.start} to="knee" horizontal length={reach} />
      <arc ref={s.curl} from="knee" to="tipBase" tangent={s.out} radius={bend} angle={tilt} />
      {rise > 0 && <line from="tipBase" to="tip" tangent={s.curl} length={rise} />}
    </sketch>
  )
}

export default function CoatHook(p: ParamValues<typeof params>) {
  const width = Math.max(24, p.rod * 3)
  const hookZ = p.plate * 0.3
  return (
    <part name="coat-hook" material="petg">
      <difference>
        <union>
          {/* wall plate in XZ, its front face at y = 0 */}
          <extrude height={p.thickness} plane="XZ">
            <roundedRect w={width} h={p.plate} r={width / 2} y={p.plate / 2} />
          </extrude>
          <sweep>
            <sweepPath plane="YZ">
              <HookPath z={hookZ} reach={p.reach} bend={p.bend} rise={p.rise} tilt={p.tilt} />
            </sweepPath>
            <circle d={p.rod} />
          </sweep>
        </union>
        {/* screw holes with countersinks, top and bottom */}
        {[p.plate * 0.12, p.plate * 0.88].map((z) => (
          <group z={z} rotateX={-90}>
            <cylinder d={4.5} h={p.thickness * 3} z={-p.thickness * 2} />
            {/* countersink: wide at the plate's front face (y = 0), narrowing into it */}
            <cone d1={4.5} d2={9} h={2.25} z={-2.25} />
          </group>
        ))}
      </difference>
    </part>
  )
}
