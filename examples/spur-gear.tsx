/**
 * Involute spur gear — the tooth flanks are computed from the involute of the base circle,
 * so any two gears with the same module and pressure angle mesh correctly.
 *
 *   tscad dev examples/spur-gear.tsx
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  teeth: { type: "int", default: 24, min: 8, max: 80, label: "Teeth" },
  module: { type: "number", default: 2, min: 0.5, max: 5, step: 0.25, unit: "mm", label: "Module" },
  pressureAngle: { type: "number", default: 20, min: 14.5, max: 25, step: 0.5, unit: "°", label: "Pressure angle" },
  thickness: { type: "number", default: 8, min: 2, max: 30, step: 0.5, unit: "mm", label: "Face width" },
  bore: { type: "number", default: 8, min: 2, max: 30, step: 0.5, unit: "mm", label: "Bore Ø" },
  hub: { type: "boolean", default: true, label: "Hub" },
  lightening: { type: "boolean", default: true, label: "Lightening holes" },
  toothChamfer: { type: "boolean", default: false, label: "Chamfer teeth (slow: every tooth edge)" },
})

type Pt = [number, number]

/**
 * The outline of an involute gear as SVG path data: each flank is the true involute fitted with
 * a cubic Bézier (Hermite: exact ends and tangents), joined by exact arcs along the tip and root
 * circles. Smooth flanks become single B-rep faces.
 */
export function involuteGear(teeth: number, module: number, pressureDeg: number, pieces = 1): string {
  const alpha = (pressureDeg * Math.PI) / 180
  const r = (module * teeth) / 2 // pitch radius
  const rb = r * Math.cos(alpha) // base radius
  const ra = r + module // addendum (tip) radius
  const rf = r - 1.25 * module // dedendum (root) radius
  const inv = (a: number) => Math.tan(a) - a
  // Half the angular tooth thickness at the base circle.
  const half = Math.PI / (2 * teeth) + inv(alpha)
  const tAt = (radius: number) => Math.sqrt(Math.max(0, (radius / rb) ** 2 - 1))
  const t1 = tAt(ra)
  // Start a hair above the base circle: the involute's tangent vanishes exactly on it.
  const t0 = Math.max(tAt(Math.max(rb, rf)), t1 * 0.03)

  const polar = (radius: number, angle: number): Pt => [radius * Math.cos(angle), radius * Math.sin(angle)]
  // A flank as a function of the involute parameter t: side -1 leads, +1 trails.
  const flank = (c: number, side: number) => (t: number): Pt => polar(rb * Math.sqrt(1 + t * t), c + side * (half - (t - Math.atan(t))))
  const f = (v: number) => +v.toFixed(5)
  const P = (p: Pt) => `${f(p[0])} ${f(p[1])}`
  /** Cubic Bézier pieces of `g` from parameter a to b (Hermite with numeric tangents). */
  const curve = (g: (t: number) => Pt, a: number, b: number) => {
    let d = ""
    const h = 1e-6
    const D = (t: number): Pt => {
      const p = g(t + h), q = g(t - h)
      return [(p[0] - q[0]) / (2 * h), (p[1] - q[1]) / (2 * h)]
    }
    for (let i = 0; i < pieces; i++) {
      const ta = a + ((b - a) * i) / pieces, tb = a + ((b - a) * (i + 1)) / pieces
      const pa = g(ta), pb = g(tb), da = D(Math.max(ta, 1e-5)), db = D(Math.max(tb, 1e-5)), k = (tb - ta) / 3
      d += ` C ${P([pa[0] + da[0] * k, pa[1] + da[1] * k])} ${P([pb[0] - db[0] * k, pb[1] - db[1] * k])} ${P(pb)}`
    }
    return d
  }

  let d = ""
  for (let i = 0; i < teeth; i++) {
    const c = (2 * Math.PI * i) / teeth
    const lead = flank(c, -1), trail = flank(c, 1)
    const start = rf < rb ? polar(rf, c - half) : lead(t0)
    d += i === 0 ? `M ${P(start)}` : ` A ${f(rf)} ${f(rf)} 0 0 1 ${P(start)}` // root arc from the last tooth
    if (rf < rb) d += ` L ${P(lead(t0))}` // radial line up to the base circle
    d += curve(lead, t0, t1)
    d += ` A ${f(ra)} ${f(ra)} 0 0 1 ${P(trail(t1))}` // tip land
    d += curve(trail, t1, t0)
    if (rf < rb) d += ` L ${P(polar(rf, c + half))}`
  }
  const first = rf < rb ? polar(rf, -half) : flank(0, -1)(t0)
  return `${d} A ${f(rf)} ${f(rf)} 0 0 1 ${P(first)} Z`
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
      {/* break the bore's sharp edges (cheap: two circles) */}
      <chamfer distance={0.5} edges={edges.radius(p.bore / 2)}>
        <difference>
          <union>
            <chamfer distance={p.toothChamfer ? p.module * 0.2 : 0} edges=">Z or <Z">
              <extrude height={p.thickness}>
                <path d={involuteGear(p.teeth, p.module, p.pressureAngle)} />
              </extrude>
            </chamfer>
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
      </chamfer>
    </part>
  )
}
