/**
 * Engraved coaster: a round puck with a rounded top edge and an SVG logo engraved into it.
 * The logo is plain SVG text, imported with `with { type: "text" }` and used as a 2D shape:
 * its arcs stay exact arcs, its holes come from the SVG's fill rule, and `center` puts it in
 * the middle.
 *
 *   tscad dev examples/engraved-logo.tsx
 */
import { defineParams, edges, type ParamValues } from "tscad"
// @ts-ignore: a text import (Bun): the file's contents as a string
import logo from "./assets/logo.svg" with { type: "text" }

export const params = defineParams({
  diameter: { type: "number", default: 90, min: 60, max: 150, step: 1, unit: "mm", label: "Diameter" },
  thickness: { type: "number", default: 5, min: 3, max: 12, step: 0.5, unit: "mm", label: "Thickness" },
  logoSize: { type: "number", default: 1, min: 0.3, max: 1.8, step: 0.05, label: "Logo scale" },
  depth: { type: "number", default: 1.2, min: 0.2, max: 3, step: 0.1, unit: "mm", label: "Engrave depth" },
})

export default function EngravedCoaster(p: ParamValues<typeof params>) {
  return (
    <part name="coaster" color="#c8a27a">
      <difference>
        <fillet radius={1.5} edges={edges.max("z")}>
          <cylinder r={p.diameter / 2} h={p.thickness} />
        </fillet>
        {/* the logo, cut `depth` into the top face */}
        <extrude height={p.depth + 1} z={p.thickness - p.depth}>
          <svg data={logo as string} select="#mark" scale={p.logoSize} center />
        </extrude>
      </difference>
    </part>
  )
}
