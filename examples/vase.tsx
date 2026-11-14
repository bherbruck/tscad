/**
 * Lathe-turned vase: a smooth spline profile revolved about Z, then shelled from the top.
 * The silhouette is driven by four radii — tweak them and watch the curve follow.
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
function smoothPath(pts: [number, number][]): string {
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
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
  const d = `${smoothPath(outline)} L 0 ${h} L 0 0 Z`

  return (
    <part name="vase" color={GLAZE[p.color]}>
      <shell thickness={-p.wall} open={faces.max("z")}>
        {/* revolve about Z: sketch x is the radius, sketch y the height */}
        <revolve>
          <path d={d} />
        </revolve>
      </shell>
    </part>
  )
}
