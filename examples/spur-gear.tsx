/**
 * Involute spur gear — the tooth flanks are computed from the involute of the base circle,
 * so any two gears with the same module and pressure angle mesh correctly.
 *
 *   tscad dev examples/spur-gear.tsx
 */
import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  teeth: { type: "int", default: 24, min: 8, max: 80, label: "Teeth" },
  module: { type: "number", default: 2, min: 0.5, max: 5, step: 0.25, unit: "mm", label: "Module" },
  pressureAngle: { type: "number", default: 20, min: 14.5, max: 25, step: 0.5, unit: "°", label: "Pressure angle" },
  thickness: { type: "number", default: 8, min: 2, max: 30, step: 0.5, unit: "mm", label: "Face width" },
  bore: { type: "number", default: 8, min: 2, max: 30, step: 0.5, unit: "mm", label: "Bore Ø" },
  hub: { type: "boolean", default: true, label: "Hub" },
  lightening: { type: "boolean", default: true, label: "Lightening holes" },
})

type Pt = [number, number]

/** The outline of an involute gear as one closed polygon, CCW. */
export function involuteGear(teeth: number, module: number, pressureDeg: number, flankSteps = 5): Pt[] {
  const alpha = (pressureDeg * Math.PI) / 180
  const r = (module * teeth) / 2 // pitch radius
  const rb = r * Math.cos(alpha) // base radius
  const ra = r + module // addendum (tip) radius
  const rf = r - 1.25 * module // dedendum (root) radius
  const inv = (a: number) => Math.tan(a) - a
  // Half the angular tooth thickness at the base circle.
  const half = Math.PI / (2 * teeth) + inv(alpha)
  const tAt = (radius: number) => Math.sqrt(Math.max(0, (radius / rb) ** 2 - 1))
  const t0 = tAt(Math.max(rb, rf))
  const t1 = tAt(ra)

  const pts: Pt[] = []
  const polar = (radius: number, angle: number): Pt => [radius * Math.cos(angle), radius * Math.sin(angle)]
  for (let i = 0; i < teeth; i++) {
    const c = (2 * Math.PI * i) / teeth
    const flank: [number, number][] = [] // [radius, angle offset from the tooth centre]
    for (let s = 0; s <= flankSteps; s++) {
      const t = t0 + ((t1 - t0) * s) / flankSteps
      flank.push([rb * Math.sqrt(1 + t * t), half - (t - Math.atan(t))])
    }
    // Leading flank (root → tip), then trailing flank (tip → root).
    if (rf < rb) pts.push(polar(rf, c - half))
    for (const [rad, a] of flank) pts.push(polar(rad, c - a))
    for (const [rad, a] of [...flank].reverse()) pts.push(polar(rad, c + a))
    if (rf < rb) pts.push(polar(rf, c + half))
  }
  return pts
}

export default function SpurGear(p: ParamValues<typeof params>) {
  const pitchR = (p.module * p.teeth) / 2
  const rootR = pitchR - 1.25 * p.module
  const hubR = Math.max(p.bore * 0.9, p.bore / 2 + 4)
  const webR = rootR - 2 * p.module // inner edge of the rim
  const holeOrbit = (hubR + webR) / 2
  const holeR = Math.min((webR - hubR) / 2 - 1.5, (Math.PI * holeOrbit) / 6 - 1.5)
  const showHoles = p.lightening && holeR > 1.5

  return (
    <part name="gear" color="#c8a24a">
      <difference>
        <union>
          <extrude height={p.thickness}>
            <polygon points={involuteGear(p.teeth, p.module, p.pressureAngle)} />
          </extrude>
          {p.hub && <cylinder r={hubR} h={p.thickness * 1.6} />}
        </union>
        {/* bore */}
        <cylinder r={p.bore / 2} h={p.thickness * 4} z={-p.thickness} />
        {/* lightening holes between hub and rim */}
        {showHoles && (
          <polarPattern count={6}>
            <cylinder r={holeR} h={p.thickness * 4} x={holeOrbit} z={-p.thickness} />
          </polarPattern>
        )}
      </difference>
    </part>
  )
}
