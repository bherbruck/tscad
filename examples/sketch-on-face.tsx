/**
 * Sketch on face: a bearing block built feature by feature, each one drawn on a face of the
 * solid so far — no coordinates computed for where the faces end up.
 * - a boss raised on the top face, with the bearing pocket and a through bore in it;
 * - four counterbored mounting holes, a constraint sketch with a circular pattern;
 * - a wire slot pocketed into the front face.
 *
 *   tscad dev examples/sketch-on-face.tsx
 */
import { defineParams, faces, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 60, min: 40, max: 120, step: 1, unit: "mm", label: "Width" },
  depth: { type: "number", default: 50, min: 30, max: 100, step: 1, unit: "mm", label: "Depth" },
  thickness: { type: "number", default: 10, min: 5, max: 25, step: 0.5, unit: "mm", label: "Base thickness" },
  boss: { type: "number", default: 32, min: 16, max: 60, step: 1, unit: "mm", label: "Boss Ø" },
  bossHeight: { type: "number", default: 8, min: 2, max: 30, step: 0.5, unit: "mm", label: "Boss height" },
  bearing: { type: "number", default: 22, min: 8, max: 50, step: 0.5, unit: "mm", label: "Bearing Ø" },
  bearingWidth: { type: "number", default: 7, min: 2, max: 20, step: 0.5, unit: "mm", label: "Bearing width" },
  bore: { type: "number", default: 10, min: 3, max: 30, step: 0.5, unit: "mm", label: "Shaft bore Ø" },
  holeSpacing: { type: "number", default: 46, min: 20, max: 110, step: 1, unit: "mm", label: "Hole circle Ø" },
})

/** Four counterbored screw holes on a circle, as one constraint sketch. */
function HoleCircle({ diameter, hole }: { diameter: number; hole: number }) {
  return (
    <sketch>
      <point id="o" fixed />
      <circle id="h" center="c" diameter={hole} />
      <dimension a="o" b="c" distance={diameter / 2} />
      <line from="o" to="c" angle={45} construction />
      <circularPattern center="o" count={4} of={["h"]} />
    </sketch>
  )
}

export default function BearingBlock(p: ParamValues<typeof params>) {
  // the base's top face (the boss stands on it, so it isn't the topmost face any more)
  const baseTop = faces.within([-p.width, -p.depth, p.thickness - 0.01], [p.width, p.depth, p.thickness + 0.01])
  return (
    <part name="bearing-block" material="aluminum">
      {/* a wire slot in the front face (−Y) */}
      <pocket face="<Y" depth={6}>
        {/* counterbores, then the through holes, on the base's top face around the boss */}
        <pocket face={baseTop} depth={3}>
          <cutThrough face="<Z">
            {/* bearing pocket and shaft bore in the boss */}
            <cutThrough face=">Z">
              <pocket face=">Z" depth={p.bearingWidth}>
                <boss face=">Z" height={p.bossHeight}>
                  <box size={[p.width, p.depth, p.thickness]} />
                  <circle d={p.boss} />
                </boss>
                <circle d={p.bearing} />
              </pocket>
              <circle d={p.bore} />
            </cutThrough>
            {/* through holes, drawn on the bottom face (its x is mirrored: the pattern is symmetric) */}
            <HoleCircle diameter={p.holeSpacing} hole={4.5} />
          </cutThrough>
          <HoleCircle diameter={p.holeSpacing} hole={8} />
        </pocket>
        <slot length={16} width={4} />
      </pocket>
    </part>
  )
}
