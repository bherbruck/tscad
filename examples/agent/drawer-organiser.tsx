/**
 * Drawer organiser: a grid of rounded compartments sized to the drawer, with a fit clearance; `piece` splits it into quarters for printers smaller than the drawer.
 *
 * Brief: "a parametric drawer organiser for a 300×200 mm drawer"
 * Designed by an agent through the tscad MCP server (see docs/mcp-dogfood.md).
 */
import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  drawerW: { type: "number", default: 300, min: 100, max: 600, step: 1, unit: "mm", label: "Drawer width" },
  drawerD: { type: "number", default: 200, min: 100, max: 600, step: 1, unit: "mm", label: "Drawer depth" },
  height: { type: "number", default: 45, min: 15, max: 120, step: 1, unit: "mm", label: "Height" },
  columns: { type: "int", default: 4, min: 1, max: 10, label: "Columns" },
  rows: { type: "int", default: 3, min: 1, max: 8, label: "Rows" },
  wall: { type: "number", default: 1.6, min: 0.8, max: 4, step: 0.1, unit: "mm", label: "Wall" },
  clearance: { type: "number", default: 1, min: 0, max: 5, step: 0.5, unit: "mm", label: "Fit clearance" },
  piece: { type: "choice", default: "all", options: ["all", "front-left", "front-right", "back-left", "back-right"], label: "Printable piece" },
})

export default function DrawerOrganiser(p: ParamValues<typeof params>) {
  const W = p.drawerW - 2 * p.clearance
  const D = p.drawerD - 2 * p.clearance
  const cw = (W - p.wall) / p.columns
  const cd = (D - p.wall) / p.rows
  const r = 4
  const cells = []
  for (let i = 0; i < p.columns; i++)
    for (let j = 0; j < p.rows; j++)
      cells.push(
        <roundedRect key={`${i}-${j}`} w={cw - p.wall} h={cd - p.wall} r={r} x={-W / 2 + p.wall / 2 + cw * (i + 0.5)} y={-D / 2 + p.wall / 2 + cd * (j + 0.5)} />,
      )
  const tray = (
    <difference>
      <extrude height={p.height}>
        <roundedRect w={W} h={D} r={r + p.wall} />
      </extrude>
      <extrude height={p.height} offset={p.wall}>{cells}</extrude>
    </difference>
  )
  if (p.piece === "all") return <part name="organiser" material="pla">{tray}</part>
  // a quarter, cut along the centre lines, for printers smaller than the drawer
  const [fb, lr] = p.piece.split("-") as ["front" | "back", "left" | "right"]
  return (
    <part name={`organiser-${p.piece}`} material="pla">
      <split plane="YZ" keep={lr === "left" ? "below" : "above"}>
        <split plane="XZ" keep={fb === "front" ? "below" : "above"}>{tray}</split>
      </split>
    </part>
  )
}
