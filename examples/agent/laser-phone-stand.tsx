/**
 * Laser-cut phone stand: two side profiles joined by a shelf and a back rest whose tenons pass through mortises; kerf-compensated cutting file plus an assembled preview.
 *
 * Brief: "a laser-cut phone stand"
 * Designed by an agent through the tscad MCP server (see docs/mcp-dogfood.md).
 */
import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  phoneWidth: { type: "number", default: 80, min: 50, max: 200, step: 1, unit: "mm", label: "Phone width" },
  thickness: { type: "number", default: 3, min: 2, max: 6, step: 0.5, unit: "mm", label: "Sheet" },
  kerf: { type: "number", default: 0.15, min: 0, max: 0.4, step: 0.01, unit: "mm", label: "Kerf" },
  assembled: { type: "boolean", default: true, label: "Assembled view" },
})

const SIDE: [number, number][] = [[0, 0], [95, 0], [95, 22], [87, 22], [87, 9], [32, 9], [14, 95], [4, 95], [0, 60]]
const SHELF = { at: [55, 4.5] as [number, number], len: 22 } // mortise in the base bar
const REST = { at: [16, 60] as [number, number], len: 16, angle: Math.atan2(95 - 9, 14 - 32) * (180 / Math.PI) } // along the rest

/** A side panel: the profile with two mortises (rect holes) for the crossbars' tenons. */
function SideShapes({ t }: { t: number }) {
  return (
    <>
      <polygon points={SIDE} />
      <rect w={SHELF.len} h={t} at={SHELF.at} />
      <rect w={REST.len} h={t} at={REST.at} rotate={REST.angle} />
    </>
  )
}

/** A crossbar: `span` between the panels plus a tenon (narrower by 2 × 3 mm shoulders) through each. */
function BarShapes({ span, depth, t }: { span: number; depth: number; t: number }) {
  const tenon = depth - 6
  const L = span / 2 + t + 1
  return <polygon points={[[-span / 2, -depth / 2], [span / 2, -depth / 2], [span / 2, -tenon / 2], [L, -tenon / 2], [L, tenon / 2], [span / 2, tenon / 2], [span / 2, depth / 2], [-span / 2, depth / 2], [-span / 2, tenon / 2], [-L, tenon / 2], [-L, -tenon / 2], [-span / 2, -tenon / 2]]} />
}

export default function LaserPhoneStand(p: ParamValues<typeof params>) {
  const t = p.thickness
  const span = p.phoneWidth + 4
  const k = p.kerf / 2
  const shelfDepth = SHELF.len + 6, restDepth = REST.len + 6
  const flat = (
    <>
      <drawing name="side-left" layer="cut"><offset distance={k} round={false}><SideShapes t={t} /></offset></drawing>
      <drawing name="side-right" layer="cut" x={100}><offset distance={k} round={false}><SideShapes t={t} /></offset></drawing>
      <drawing name="shelf" layer="cut" x={span / 2 + t + 1} y={120}><offset distance={k} round={false}><BarShapes span={span} depth={shelfDepth} t={t} /></offset></drawing>
      <drawing name="rest" layer="cut" x={span / 2 + t + 1} y={160}><offset distance={k} round={false}><BarShapes span={span} depth={restDepth} t={t} /></offset></drawing>
    </>
  )
  if (!p.assembled) return flat
  // assembled preview: side panels stand in XZ planes, crossbars run along Y through the mortises
  const side = (y: number, name: string) => (
    <part name={name} material="wood">
      <extrude plane="XZ" height={t} offset={-y}><SideShapes t={t} /></extrude>
    </part>
  )
  return (
    <>
      {flat}
      <assembly name="stand">
        {side(-span / 2, "left")}
        {side(span / 2 + t, "right")}
        <part name="shelf-3d" material="wood" at={[SHELF.at[0], 0, SHELF.at[1]]} rotate={[0, 0, 90]}>
          <extrude height={t} center><BarShapes span={span} depth={shelfDepth} t={t} /></extrude>
        </part>
        <part name="rest-3d" material="wood" at={[REST.at[0], 0, REST.at[1]]} rotate={[0, -REST.angle, 0]}>
          <extrude height={t} center rotateZ={90}><BarShapes span={span} depth={restDepth} t={t} /></extrude>
        </part>
      </assembly>
    </>
  )
}
