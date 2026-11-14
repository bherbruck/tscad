/**
 * Pipe flange with two mounting lugs, drawn as one constraint sketch:
 * - the right lug is drawn once (two lines tangent to the flange circle and to the lug's end
 *   arc) and mirrored with <mirrorEntities>, so both lugs stay identical as params change;
 * - the bolt circle is one hole and a <circularPattern>, its copies tied by rotation
 *   constraints rather than computed coordinates.
 *
 *   tscad dev examples/sketch-flange.tsx
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  diameter: { type: "number", default: 80, min: 40, max: 200, step: 1, unit: "mm", label: "Flange Ø" },
  bore: { type: "number", default: 32, min: 10, max: 120, step: 1, unit: "mm", label: "Bore Ø" },
  bolts: { type: "int", default: 6, min: 3, max: 16, label: "Bolts" },
  boltCircle: { type: "number", default: 58, min: 25, max: 180, step: 1, unit: "mm", label: "Bolt circle Ø" },
  boltHole: { type: "number", default: 6.6, min: 2, max: 20, step: 0.1, unit: "mm", label: "Bolt hole Ø" },
  lugReach: { type: "number", default: 62, min: 30, max: 150, step: 1, unit: "mm", label: "Lug hole offset" },
  lugRadius: { type: "number", default: 10, min: 5, max: 30, step: 0.5, unit: "mm", label: "Lug end radius" },
  lugHole: { type: "number", default: 8.5, min: 3, max: 20, step: 0.1, unit: "mm", label: "Lug hole Ø" },
  thickness: { type: "number", default: 8, min: 3, max: 25, step: 0.5, unit: "mm", label: "Thickness" },
})

export default function Flange(p: ParamValues<typeof params>) {
  const R = p.diameter / 2
  return (
    <part name="flange" material="steel">
      <fillet radius={1} edges={edges.max("z")}>
        <extrude height={p.thickness}>
          <sketch>
            <point id="o" fixed />
            <line id="axis" from="o" to="up" vertical length={R} construction />

            {/* right lug: centre on the X axis, end arc, two tangent lines into the flange */}
            <point id="lug" />
            <horizontal a="o" b="lug" />
            <dimension a="o" b="lug" dx={p.lugReach} />
            <arc id="lugEnd" center="lug" from="l1" to="l2" radius={p.lugRadius} />
            <line id="lugTop" from="l2" to="m2" tangent="lugEnd" />
            <line id="lugBottom" from="m1" to="l1" tangent="lugEnd" />

            {/* the flange circle between the lugs: top and bottom arcs */}
            <arc id="top" center="o" from="m2" to="m2'" radius={R} tangent="lugTop" />
            <arc id="bottom" center="o" from="m1'" to="m1" equal="top" tangent="lugBottom" />
            <mirrorEntities about="axis" of={["lugEnd", "lugTop", "lugBottom"]} />

            {/* holes: bore, lug holes, bolt circle */}
            <circle center="o" diameter={p.bore} />
            <circle center="lug" diameter={p.lugHole} />
            <circle center="lug'" diameter={p.lugHole} />
            <circle id="bolt" center="b" diameter={p.boltHole} />
            <dimension a="o" b="b" distance={p.boltCircle / 2} />
            <line from="o" to="b" angle={90 + 180 / p.bolts} construction />
            <circularPattern center="o" count={p.bolts} of={["bolt"]} />
          </sketch>
        </extrude>
      </fillet>
    </part>
  )
}
