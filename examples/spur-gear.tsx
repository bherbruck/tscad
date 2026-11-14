/**
 * Involute spur gear: the tooth flanks are computed from the involute of the base circle,
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
 * a cubic Bézier (Hermite: exact ends and tangents), blended into the root circle by a tangent
 * fillet, with exact arcs along the tip and root circles. Smooth flanks become single B-rep faces.
 */
/** Where an involute flank starts (involute parameter `t0`). */
function flankStart(teeth: number, module: number, pressureDeg: number): number {
  const alpha = (pressureDeg * Math.PI) / 180
  const r = (module * teeth) / 2
  const rb = r * Math.cos(alpha)
  const tAt = (radius: number) => Math.sqrt(Math.max(0, (radius / rb) ** 2 - 1))
  // Start a hair above the base circle: the involute's tangent vanishes exactly on it.
  return Math.max(tAt(Math.max(rb, r - 1.25 * module)), tAt(r + module) * 0.03)
}

/**
 * The widest chamfer the kernel takes along SVG path data: under the tightest bend radius of
 * its cubic pieces (sampled), and under half its shortest piece (the kernel's own limit).
 */
export function chamferLimit(d: string): number {
  const tok = d.match(/[A-Za-z]|-?[\d.]+(?:e-?\d+)?/g) ?? []
  let bend = Infinity
  let shortest = Infinity
  let p: Pt = [0, 0]
  const to = (q: Pt) => {
    shortest = Math.min(shortest, Math.hypot(q[0] - p[0], q[1] - p[1]))
    p = q
  }
  for (let i = 0; i < tok.length; ) {
    const cmd = tok[i++]!
    const n = (k: number) => tok.slice(i, i + k).map(Number)
    if (cmd === "M" || cmd === "L") (p = n(2) as Pt), (i += 2)
    else if (cmd === "A") to(n(7).slice(5) as Pt), (i += 7)
    else if (cmd === "C") {
      const [bx, by, cx, cy, dx, dy] = n(6)
      const a = p, b: Pt = [bx!, by!], c: Pt = [cx!, cy!], e: Pt = [dx!, dy!]
      for (let k = 0; k <= 64; k++) {
        const t = k / 64, u = 1 - t
        const d1 = [0, 1].map((j) => 3 * u * u * (b[j]! - a[j]!) + 6 * u * t * (c[j]! - b[j]!) + 3 * t * t * (e[j]! - c[j]!))
        const d2 = [0, 1].map((j) => 6 * u * (c[j]! - 2 * b[j]! + a[j]!) + 6 * t * (e[j]! - 2 * c[j]! + b[j]!))
        const cross = Math.abs(d1[0]! * d2[1]! - d1[1]! * d2[0]!)
        if (cross > 1e-12) bend = Math.min(bend, Math.hypot(d1[0]!, d1[1]!) ** 3 / cross)
      }
      to(e)
      i += 6
    }
  }
  return Math.min(bend * 0.8, shortest * 0.45)
}

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
  const t0 = flankStart(teeth, module, pressureDeg)

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

  // Half the angular width of the gap at the root circle, and how much of it the fillets take.
  const gapHalf = Math.PI / teeth - half
  const phi = Math.min((0.38 * module) / rf, gapHalf * 0.7)
  const fillet = (c: number, side: number) => {
    const root = polar(rf, c + side * (half + phi))
    const g = flank(c, side)
    const top = g(t0)
    const h = 1e-6
    const q = g(t0 + h)
    const dir: Pt = [(q[0] - top[0]) / h, (q[1] - top[1]) / h] // flank tangent, pointing outward
    const dl = Math.hypot(dir[0], dir[1]) || 1
    const L1 = phi * rf * 0.55 // along the root circle: stays inside the gap
    // down the flank, but never below the root circle
    const L2 = Math.min(Math.hypot(top[0] - root[0], top[1] - root[1]) * 0.4, (Math.hypot(top[0], top[1]) - rf) * 0.9)
    const ang = c + side * (half + phi)
    // tangent of the root circle, pointing toward the tooth
    const tan: Pt = [side * Math.sin(ang), -side * Math.cos(ang)]
    const c1: Pt = [root[0] + tan[0] * L1, root[1] + tan[1] * L1]
    const c2: Pt = [top[0] - (dir[0] / dl) * L2, top[1] - (dir[1] / dl) * L2]
    return { root, up: ` C ${P(c1)} ${P(c2)} ${P(top)}`, down: ` C ${P(c2)} ${P(c1)} ${P(root)}` }
  }

  let d = ""
  for (let i = 0; i < teeth; i++) {
    const c = (2 * Math.PI * i) / teeth
    const lead = flank(c, -1), trail = flank(c, 1)
    // Root fillets: a smooth cubic from the root circle (tangent to it) up into the flank
    // (tangent to it), so the tooth widens toward its root like a hobbed gear.
    const fl = fillet(c, -1), fr = fillet(c, 1)
    d += i === 0 ? `M ${P(fl.root)}` : ` A ${f(rf)} ${f(rf)} 0 0 1 ${P(fl.root)}` // root land from the last tooth
    d += fl.up
    d += curve(lead, t0, t1)
    d += ` A ${f(ra)} ${f(ra)} 0 0 1 ${P(trail(t1))}` // tip land
    d += curve(trail, t1, t0)
    d += fr.down
  }
  return `${d} A ${f(rf)} ${f(rf)} 0 0 1 ${P(fillet(0, -1).root)} Z`
}

export default function SpurGear(p: ParamValues<typeof params>) {
  const pitchR = (p.module * p.teeth) / 2
  const rootR = pitchR - 1.25 * p.module
  const hubR = Math.max(p.bore * 0.9, p.bore / 2 + 4)
  const webR = rootR - 2 * p.module // inner edge of the rim
  const holeOrbit = (hubR + webR) / 2
  const holeR = Math.min((webR - hubR) / 2 - 1.5, (Math.PI * holeOrbit) / 6 - 1.5)
  const showHoles = p.lightening && holeR > 1.5
  const outline = involuteGear(p.teeth, p.module, p.pressureAngle)

  return (
    <part name="gear" color="#c8a24a">
      {/* break the bore's sharp edges (cheap: two circles) */}
      <chamfer distance={0.5} edges={edges.radius(p.bore / 2)}>
        <difference>
          <union>
            {/* no wider than the outline's tightest bend or half its shortest edge */}
            <chamfer distance={p.toothChamfer ? Math.min(p.module * 0.07, chamferLimit(outline)) : 0} edges=">Z or <Z">
              <extrude height={p.thickness}>
                <path d={outline} />
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
