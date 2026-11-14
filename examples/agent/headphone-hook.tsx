/**
 * Desk headphone hook: a C clamp over the desk edge (M6 clamp screw through the lower jaw) and a hook with a lip below. Print it upside down: no overhangs.
 *
 * Brief: "a desk headphone hook that clamps to a 25 mm desk edge"
 * Designed by an agent through the tscad MCP server (see docs/mcp-dogfood.md).
 */
import { defineParams, type ParamValues } from "tscad"
import { TapHole } from "tscad/parts"

export const params = defineParams({
  desk: { type: "number", default: 25, min: 10, max: 50, step: 0.5, unit: "mm", label: "Desk thickness" },
  width: { type: "number", default: 30, min: 15, max: 60, step: 1, unit: "mm", label: "Width" },
  reach: { type: "number", default: 45, min: 25, max: 80, step: 1, unit: "mm", label: "Hook reach" },
  wall: { type: "number", default: 6, min: 4, max: 10, step: 0.5, unit: "mm", label: "Wall" },
})

export default function HeadphoneHook(p: ParamValues<typeof params>) {
  const { desk: D, wall: t, reach: R } = p
  const jaw = 40
  // side profile: x = into the desk, y = up; the desk top is at y = 0
  const pts: [number, number][] = [
    [-t, t], [jaw, t], [jaw, 0], [0, 0], [0, -D], [jaw - 10, -D], [jaw - 10, -D - t],
    [-R, -D - t], [-R, -D + 10], [-R + t, -D + 10], [-R + t, -D], [-t, -D],
  ]
  return (
    <part name="hook" material="petg">
      <difference>
        <fillet radius={1.5} edges="|Y">
          <extrude height={p.width} plane="XZ" center>
            <polygon points={pts} />
          </extrude>
        </fillet>
        {/* clamp screw through the bottom jaw */}
        <TapHole size="M6" depth={t} x={jaw - 20} z={-D} />
      </difference>
    </part>
  )
}
