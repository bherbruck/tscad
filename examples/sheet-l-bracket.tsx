/**
 * Bent L-bracket in sheet steel: a base with two slotted mounting holes, an upright flange with
 * a hole pattern, and a short return lip for stiffness. Besides the folded part, the build
 * gives the flat pattern (outline on "cut", bend lines on "bend", "UP 90° R2" notes on
 * "engrave"):
 *
 *   tscad build examples/sheet-l-bracket.tsx -o bracket.dxf
 */
import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 60, min: 30, max: 200, step: 1, unit: "mm", label: "Width" },
  base: { type: "number", default: 40, min: 20, max: 120, step: 1, unit: "mm", label: "Base depth" },
  height: { type: "number", default: 50, min: 20, max: 150, step: 1, unit: "mm", label: "Upright height" },
  thickness: { type: "number", default: 2, min: 0.5, max: 6, step: 0.1, unit: "mm", label: "Thickness" },
  bendRadius: { type: "number", default: 2, min: 0.5, max: 10, step: 0.1, unit: "mm", label: "Bend radius" },
  lip: { type: "number", default: 8, min: 0, max: 30, step: 0.5, unit: "mm", label: "Return lip" },
  hole: { type: "number", default: 5.5, min: 2, max: 12, step: 0.1, unit: "mm", label: "Hole Ø" },
})

export default function LBracket(p: ParamValues<typeof params>) {
  const holes = Math.max(1, Math.floor((p.width - 20) / 20) + 1)
  const pitch = holes > 1 ? (p.width - 20) / (holes - 1) : 0
  return (
    <part name="l-bracket" material="steel">
      <sheetMetal name="l-bracket" thickness={p.thickness} bendRadius={p.bendRadius}>
        <flange>
          <rect w={p.width} h={p.base} />
          {/* slotted mounting holes in the base */}
          {[-1, 1].map((s) => <slot length={p.hole * 2.5} width={p.hole} x={(s * p.width) / 4} y={-p.base / 6} />)}
          <edgeFlange edge="+y" length={p.height}>
            {/* a row of holes up the flange (x along the bend, y up from it) */}
            {Array.from({ length: holes }, (_, i) => <circle d={p.hole} x={10 + i * pitch} y={p.height * 0.6} />)}
            {p.lip > 0 && <edgeFlange edge="end" length={p.lip} direction="down" />}
          </edgeFlange>
        </flange>
      </sheetMetal>
    </part>
  )
}
