/**
 * Laser-cut box: a finger-jointed box from sheet material, with an optional lid and dividers.
 * `assembled` folds the panels into the box (to see it and check the joints); either way
 * `tscad build examples/laser-box.tsx -o box.dxf` writes the cutting file (panels on layer
 * CUT, engraved labels on layer ENGRAVE).
 *
 *   tscad dev examples/laser-box.tsx
 */
import { defineParams, type ParamValues } from "tscad"
import { FingerJointBox, LivingHinge } from "tscad/parts"

export const params = defineParams({
  width: { type: "number", default: 120, min: 40, max: 400, step: 1, unit: "mm", label: "Width" },
  depth: { type: "number", default: 80, min: 40, max: 300, step: 1, unit: "mm", label: "Depth" },
  height: { type: "number", default: 60, min: 20, max: 200, step: 1, unit: "mm", label: "Height" },
  thickness: { type: "number", default: 3, min: 1.5, max: 6, step: 0.5, unit: "mm", label: "Sheet thickness" },
  fingerWidth: { type: "number", default: 10, min: 4, max: 30, step: 0.5, unit: "mm", label: "Finger width" },
  kerf: { type: "number", default: 0.15, min: 0, max: 0.5, step: 0.01, unit: "mm", label: "Kerf" },
  lid: { type: "boolean", default: true, label: "Lid" },
  dividers: { type: "int", default: 1, min: 0, max: 4, label: "Dividers" },
  assembled: { type: "boolean", default: true, label: "Assembled view" },
  hingeTag: { type: "boolean", default: true, label: "Hinged tag" },
})

export default function LaserBox(p: ParamValues<typeof params>) {
  return (
    <>
      <FingerJointBox
        width={p.width}
        depth={p.depth}
        height={p.height}
        thickness={p.thickness}
        fingerWidth={p.fingerWidth}
        kerf={p.assembled ? 0 : p.kerf}
        lid={p.lid}
        dividers={p.dividers}
        assembled={p.assembled}
      />
      {/* a flexible luggage tag: a living hinge lets it bend around a handle */}
      {p.hingeTag && (
        <drawing name="tag" layer="cut" x={-90} y={0}>
          <roundedRect w={80} h={30} r={5} center={false} />
          <circle d={5} x={8} y={15} />
          <LivingHinge width={24} height={26} x={44} y={15} />
        </drawing>
      )}
    </>
  )
}
