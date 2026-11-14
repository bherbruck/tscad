/**
 * `tscad/parts`: a standard library of parametric components: fastener holes with ISO
 * metric data, hardware pockets, mounting patterns and stock profiles. Each is a plain
 * function component built from tscad's intrinsic elements, with placement props.
 *
 * @example
 * import { CounterboreHole, BoltPattern, mountPatterns } from "tscad/parts"
 * <difference>
 *   <box size={[60, 60, 6]} />
 *   <BoltPattern pattern={mountPatterns.nema17} z={6}><CounterboreHole size="M3" depth={6} /></BoltPattern>
 * </difference>
 */
export { metric, metricData, metricSizes, type HoleFit, type MetricData, type MetricSize } from "./metric";
export {
  CounterboreHole, CountersinkHole, Hole, TapHole,
  type CounterboreHoleProps, type CountersinkHoleProps, type HoleProps, type TapHoleProps,
} from "./holes";
export { HeatSetInsert, NutTrap, Standoff, type HeatSetInsertProps, type NutTrapProps, type StandoffProps } from "./hardware";
export { BoltPattern, MountHoles, mountPatterns, type BoltPatternProps, type MountHolesProps, type MountPattern } from "./patterns";
export { Extrusion2020, extrusion2020Outline, HexPrism, type Extrusion2020Props, type HexPrismProps } from "./profiles";
export { FingerJointBox, fingerBoxPanels, LivingHinge, type BoxPanel, type FingerJointBoxProps, type LivingHingeProps } from "./laser";
export { Board, BoardCase, boardCaseLayout, boards, boardTop, connectorFace, type BoardCaseProps, type BoardDef, type BoardName, type BoardProps, type Connector, type ConnectorType, type Facing } from "./boards";
export {
  Bearing, Bolt, clearance, DowelPin, Nut, SetScrew, ShaftCollar, Washer,
  type BearingProps, type BoltProps, type DowelPinProps, type NutProps, type SetScrewProps, type ShaftCollarProps, type WasherProps,
} from "./fasteners";
export {
  bearings, boltHeads, flatWashers, nylocHeight, setScrewSockets, shaftCollars, springWashers,
  type BearingData, type BearingDesignation, type BoltHead, type CollarBore, type HeadData, type WasherData,
} from "./fastener-data";
