/**
 * Fastener holes as **cutting tools**: each points down −Z from z = 0, so it drops into a
 * `<difference>` at the top face of a part (move it with placement props, flip it with
 * `rotateX={180}` for holes from below).
 *
 * @example
 * <difference>
 *   <box size={[40, 40, 6]} />
 *   <CounterboreHole size="M3" depth={6} x={10} z={6} />
 * </difference>
 */
import type { Placement } from "../core/intrinsics";
import { metricData, type HoleFit, type MetricSize } from "./metric";
import { placement, positive } from "./place";

/** A tiny overshoot above z = 0 so tools never share a face with the part's top. */
const LIFT = 0.01;

interface HoleBase extends Placement {
  /** ISO metric size, e.g. `"M3"`. */
  size: MetricSize;
  /** Hole depth below z = 0, mm. Default 20 (through most printed parts). */
  depth?: number;
}

/** Props of {@link Hole}. */
export interface HoleProps extends HoleBase {
  /** ISO 273 clearance fit. Default `"normal"` (medium series: M3 → 3.4 mm). */
  fit?: HoleFit;
  /** Override the diameter, mm (e.g. for a printer that shrinks holes). */
  diameter?: number;
}

/** A plain clearance hole (ISO 273). */
export function Hole(props: HoleProps) {
  const m = metricData(props.size);
  const depth = props.depth ?? 20;
  positive("Hole", "depth", depth);
  positive("Hole", "diameter", props.diameter);
  const d = props.diameter ?? m.clearance[props.fit ?? "normal"];
  return (
    <group {...placement(props)}>
      <cylinder d={d} h={depth + LIFT} z={-depth} />
    </group>
  );
}

/** Props of {@link CounterboreHole}. */
export interface CounterboreHoleProps extends HoleProps {
  /** Counterbore diameter, mm. Default: DIN 974-1 for a socket head cap screw (M3 → 6.5). */
  boreDiameter?: number;
  /** Counterbore depth, mm. Default: head height + clearance (M3 → 3.4). */
  boreDepth?: number;
}

/** A clearance hole with a counterbore for a socket head cap screw (ISO 4762). */
export function CounterboreHole(props: CounterboreHoleProps) {
  const m = metricData(props.size);
  const depth = props.depth ?? 20;
  const bd = props.boreDiameter ?? m.counterbore.diameter;
  const bh = Math.min(props.boreDepth ?? m.counterbore.depth, depth);
  positive("CounterboreHole", "depth", depth);
  positive("CounterboreHole", "boreDiameter", bd);
  positive("CounterboreHole", "boreDepth", bh);
  const d = props.diameter ?? m.clearance[props.fit ?? "normal"];
  return (
    <group {...placement(props)}>
      <cylinder d={d} h={depth + LIFT} z={-depth} />
      <cylinder d={bd} h={bh + LIFT} z={-bh} />
    </group>
  );
}

/** Props of {@link CountersinkHole}. */
export interface CountersinkHoleProps extends HoleProps {
  /** Countersink diameter at the surface, mm. Default: the ISO 10642 head diameter (M3 → 6.72). */
  sinkDiameter?: number;
  /** Included countersink angle, degrees. Default 90 (metric). */
  angle?: number;
}

/** A clearance hole with a countersink for a flat-head screw (ISO 10642, 90°). */
export function CountersinkHole(props: CountersinkHoleProps) {
  const m = metricData(props.size);
  const depth = props.depth ?? 20;
  positive("CountersinkHole", "depth", depth);
  const d = props.diameter ?? m.clearance[props.fit ?? "normal"];
  const D = props.sinkDiameter ?? m.countersunk.diameter;
  const angle = props.angle ?? m.countersunk.angle;
  if (!(angle > 0 && angle < 180)) throw new RangeError(`<CountersinkHole> angle must be between 0 and 180 (got ${angle})`);
  if (!(D > d)) throw new RangeError(`<CountersinkHole> sinkDiameter (${D}) must be larger than the hole (${d})`);
  const t = Math.tan(((angle / 2) * Math.PI) / 180);
  const h = Math.min((D - d) / 2 / t, depth);
  return (
    <group {...placement(props)}>
      <cylinder d={d} h={depth + LIFT} z={-depth} />
      {/* the cone: D at the surface, narrowing at the countersink angle; a hair above z = 0 */}
      <cone r1={D / 2 - h * t} r2={D / 2 + LIFT * t} h={h + LIFT} z={-h} />
    </group>
  );
}

/** Props of {@link TapHole}. */
export interface TapHoleProps extends HoleBase {
  /** Override the drill diameter, mm (default: tap drill, M4 → 3.3). */
  diameter?: number;
}

/** A tap-drill hole for cutting (or self-tapping) a coarse metric thread. Default depth 10. */
export function TapHole(props: TapHoleProps) {
  const m = metricData(props.size);
  const depth = props.depth ?? 10;
  positive("TapHole", "depth", depth);
  return (
    <group {...placement(props)}>
      <cylinder d={props.diameter ?? m.tapDrill} h={depth + LIFT} z={-depth} />
    </group>
  );
}
