/**
 * Engraved name tag for a laser cutter: a rounded tag with a hole, the name engraved on its own
 * DXF layer. `tscad build name-tag.tsx -o tag.dxf` gives the cutting file (CUT + ENGRAVE); a
 * 3D part with the name engraved previews it in the viewer.
 */
import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  name: { type: "text", default: "tscad", maxLength: 16, label: "Name" },
  width: { type: "number", default: 70, min: 30, max: 200, step: 1, unit: "mm", label: "Width" },
  height: { type: "number", default: 26, min: 15, max: 80, step: 1, unit: "mm", label: "Height" },
  thickness: { type: "number", default: 3, min: 1, max: 6, step: 0.5, unit: "mm", label: "Sheet" },
})

export default function NameTag(p: ParamValues<typeof params>) {
  const hole = p.height * 0.18
  const textSize = Math.min(p.height * 0.5, ((p.width - 4 * hole) / Math.max(1, p.name.length)) * 1.6)
  const outline = (
    <>
      <roundedRect w={p.width} h={p.height} r={p.height / 4} />
      <circle r={hole / 2} x={-p.width / 2 + hole * 1.4} />
    </>
  )
  const label = (
    <text size={textSize} align="center" valign="middle" x={hole}>
      {p.name}
    </text>
  )
  return (
    <>
      {/* the cutting file: outline on CUT, the name on ENGRAVE */}
      <drawing name="tag" layer="cut">{outline}</drawing>
      <drawing name="label" layer="engrave">{label}</drawing>
      {/* a 3D preview for the viewer: the sheet with the name engraved 0.5 mm deep */}
      <part name="tag-3d" material="wood">
        <difference>
          <extrude height={p.thickness}>{outline}</extrude>
          <extrude height={1} offset={p.thickness - 0.5}>{label}</extrude>
        </difference>
      </part>
    </>
  )
}
