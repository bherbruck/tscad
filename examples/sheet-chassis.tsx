/**
 * Electronics chassis tray: a base with ventilation slots and standoff holes, four walls
 * folded up with closed (mitred) or overlapped corners and round corner reliefs, a connector
 * cut-out in the back wall, and tapered mounting tabs folded out along the side walls. Build
 * the flat pattern (cut, bend lines + notes, engrave) for the laser and the brake:
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
  corners: { type: "choice", options: ["closed", "overlap", "open"], default: "closed", label: "Corners" },
})

export default function Chassis(p: ParamValues<typeof params>) {
  const { width: W, depth: D, wall: H } = p
  const ventPitch = p.vents > 1 ? (W - 50) / (p.vents - 1) : 0
  // every wall meets its neighbours the same way; round reliefs where the bends meet
  const corner = { corner: p.corners, cornerRelief: "round" } as const
  // a mounting tab: tapered, with a screw hole, hanging from a side wall's top edge
  const tabW = D - 20
  const Tab = () => (
    <edgeFlange edge="end" direction="down" inset={10} profile>
      <polygon points={[[0, 0], [tabW, 0], [tabW - p.tab, p.tab], [p.tab, p.tab]]} />
      <circle d={4} x={tabW / 2} y={p.tab / 2} />
    </edgeFlange>
  )
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
          <edgeFlange edge="-y" length={H} {...corner} />
          <edgeFlange edge="+y" length={H} {...corner}>
            {/* connector cut-out in the back wall */}
            <roundedRect w={40} h={14} r={2} x={W / 2} y={H / 2} />
          </edgeFlange>
          {/* side walls, each with a tapered mounting tab folded outward along its top */}
          <edgeFlange edge="-x" length={H} {...corner}>
            <Tab />
          </edgeFlange>
          <edgeFlange edge="+x" length={H} {...corner}>
            <Tab />
          </edgeFlange>
        </flange>
      </sheetMetal>
    </part>
  )
}
