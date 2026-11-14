/**
 * Electronics chassis tray: a base with ventilation slots and standoff holes, four walls
 * folded up with open corners, a connector cut-out in the back wall, and mounting tabs folded
 * out along the side walls. Build the flat pattern for the laser and the brake:
 *
 *   tscad build examples/sheet-chassis.tsx -o chassis.dxf
 */
import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 160, min: 80, max: 400, step: 1, unit: "mm", label: "Width" },
  depth: { type: "number", default: 110, min: 60, max: 300, step: 1, unit: "mm", label: "Depth" },
  wall: { type: "number", default: 35, min: 10, max: 120, step: 1, unit: "mm", label: "Wall height" },
  thickness: { type: "number", default: 1.2, min: 0.5, max: 3, step: 0.1, unit: "mm", label: "Thickness" },
  bendRadius: { type: "number", default: 1.2, min: 0.5, max: 6, step: 0.1, unit: "mm", label: "Bend radius" },
  tab: { type: "number", default: 12, min: 6, max: 30, step: 0.5, unit: "mm", label: "Mounting tab" },
  vents: { type: "int", default: 8, min: 0, max: 20, label: "Vent slots" },
})

export default function Chassis(p: ParamValues<typeof params>) {
  const { width: W, depth: D, wall: H } = p
  const ventPitch = p.vents > 1 ? (W - 50) / (p.vents - 1) : 0
  return (
    <part name="chassis" material="aluminum">
      <sheetMetal name="chassis" thickness={p.thickness} bendRadius={p.bendRadius} kFactor={0.42}>
        <flange>
          <rect w={W} h={D} />
          {/* vents: a row of slots across the floor */}
          {Array.from({ length: p.vents }, (_, i) => <slot length={D * 0.4} width={4} rotate={90} x={-W / 2 + 25 + i * ventPitch} />)}
          {/* standoff holes for a PCB */}
          {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => <circle d={3.4} x={sx! * (W / 2 - 15)} y={sy! * (D / 2 - 15)} />)}
          {/* front and back walls */}
          <edgeFlange edge="-y" length={H} />
          <edgeFlange edge="+y" length={H}>
            {/* connector cut-out in the back wall */}
            <roundedRect w={40} h={14} r={2} x={W / 2} y={H / 2} />
          </edgeFlange>
          {/* side walls, each with a mounting tab folded outward along its top */}
          <edgeFlange edge="-x" length={H}>
            <edgeFlange edge="end" length={p.tab} direction="down" inset={10}>
              <circle d={4} x={(D - 20) / 2} y={p.tab / 2} />
            </edgeFlange>
          </edgeFlange>
          <edgeFlange edge="+x" length={H}>
            <edgeFlange edge="end" length={p.tab} direction="down" inset={10}>
              <circle d={4} x={(D - 20) / 2} y={p.tab / 2} />
            </edgeFlange>
          </edgeFlange>
        </flange>
      </sheetMetal>
    </part>
  )
}
