/**
 * Lathe-turned vase: a smooth spline profile revolved about Z, then shelled from the top.
 * The silhouette is driven by four radii: tweak them and watch the curve follow.
 */
import { defineParams, faces, type ParamValues } from "tscad"

export const params = defineParams({
  height: { type: "number", default: 120, min: 40, max: 300, step: 1, unit: "mm", label: "Height" },
  base: { type: "number", default: 28, min: 10, max: 80, step: 1, unit: "mm", label: "Base radius" },
  belly: { type: "number", default: 45, min: 10, max: 120, step: 1, unit: "mm", label: "Belly radius" },
  neck: { type: "number", default: 16, min: 6, max: 80, step: 1, unit: "mm", label: "Neck radius" },
  lip: { type: "number", default: 24, min: 6, max: 100, step: 1, unit: "mm", label: "Lip radius" },
  wall: { type: "number", default: 2.4, min: 0.8, max: 6, step: 0.1, unit: "mm", label: "Wall" },
  color: { type: "choice", default: "terracotta", options: ["terracotta", "celadon", "porcelain"], label: "Glaze" },
})

const GLAZE = { terracotta: "#c4623d", celadon: "#8fb9a8", porcelain: "#f2efe8" } as const

/** A smooth path through `pts` (Catmull-Rom → cubic Béziers) as an SVG path string. */
/** The Catmull-Rom curve as cubic Bézier pieces `[p1, c1, c2, p2]`. */
function smoothPieces(pts: [number, number][], minX = -Infinity): number[][][] {
  const out: number[][][] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!
    // control points kept right of `minX`, so a big swing can't overshoot across the axis
    const c1 = [Math.max(minX, p1[0] + (p2[0] - p0[0]) / 6), p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [Math.max(minX, p2[0] - (p3[0] - p1[0]) / 6), p2[1] - (p3[1] - p1[1]) / 6]
    out.push([p1, c1, c2, p2])
  }
  return out
}

/** The tightest bend radius along Bézier pieces (sampled). */
function minBendRadius(pieces: number[][][]): number {
  let best = Infinity
  for (const [a, b, c, d] of pieces) {
    for (let k = 0; k <= 32; k++) {
      const t = k / 32, u = 1 - t
      const d1 = [0, 1].map((j) => 3 * u * u * (b![j]! - a![j]!) + 6 * u * t * (c![j]! - b![j]!) + 3 * t * t * (d![j]! - c![j]!))
      const d2 = [0, 1].map((j) => 6 * u * (c![j]! - 2 * b![j]! + a![j]!) + 6 * t * (d![j]! - 2 * c![j]! + b![j]!))
      const cross = Math.abs(d1[0]! * d2[1]! - d1[1]! * d2[0]!)
      if (cross > 1e-12) best = Math.min(best, Math.hypot(d1[0]!, d1[1]!) ** 3 / cross)
    }
  }
  return best
}

function smoothPath(pts: [number, number][], minX = -Infinity): string {
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!
    // control points kept right of `minX`, so a big swing can't overshoot across the axis
    const c1 = [Math.max(minX, p1[0] + (p2[0] - p0[0]) / 6), p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [Math.max(minX, p2[0] - (p3[0] - p1[0]) / 6), p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`
  }
  return d
}

export default function Vase(p: ParamValues<typeof params>) {
  const h = p.height
  // Silhouette control points (radius, height), bottom to top.
  const outline: [number, number][] = [
    [p.base, 0],
    [p.belly, h * 0.35],
    [p.neck, h * 0.78],
    [p.lip, h],
  ]
  // Close the profile through the axis: outline up, across the top to the axis, back down.
  const minR = Math.min(p.base, p.belly, p.neck, p.lip)
  const d = `${smoothPath(outline, minR / 2)} L 0 ${h} L 0 0 Z`
  // the wall must fit inside the narrowest radius and the tightest bend of a short vase
  const wall = Math.min(p.wall, minR * 0.3, minBendRadius(smoothPieces(outline, minR / 2)) * 0.6)

  return (
    <part name="vase" color={GLAZE[p.color]}>
      <shell thickness={-wall} open={faces.max("z")}>
        {/* revolve about Z: sketch x is the radius, sketch y the height */}
        <revolve>
          <path d={d} />
        </revolve>
      </shell>
    </part>
  )
}
