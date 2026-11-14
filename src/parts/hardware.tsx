/** @jsxImportSource tscad */
/**
 * Pockets and bosses for hardware: nut traps, heat-set insert pockets, standoffs.
 * Pockets are cutting tools pointing −Z from z = 0 (use them in a `<difference>`);
 * `<Standoff>` is a solid that stands on z = 0.
 */
import type { Placement } from "../core/intrinsics";
import { metricData, type HoleFit, type MetricSize } from "./metric";
import { placement, positive } from "./place";

const LIFT = 0.01;

/** Props of {@link NutTrap}. */
export interface NutTrapProps extends Placement {
  /** ISO metric size of the nut (ISO 4032), e.g. `"M3"` (5.5 mm across flats). */
  size: MetricSize;
  /** Pocket depth, mm. Default: nut height + 0.2. */
  depth?: number;
  /** Extra size across flats for a press/slide fit, mm. Default 0.3. */
  clearance?: number;
  /** Also cut a clearance hole for the bolt this far below the pocket, mm. Default 0 (none). */
  boltDepth?: number;
  /** Fit of that bolt hole. Default `"normal"`. */
  fit?: HoleFit;
}

/** A hexagonal nut pocket (flats parallel to X), from z = 0 down. */
export function NutTrap(props: NutTrapProps) {
  const m = metricData(props.size);
  const depth = props.depth ?? m.nut.height + 0.2;
  const af = m.nut.af + (props.clearance ?? 0.3);
  positive("NutTrap", "depth", depth);
  positive("NutTrap", "across flats", af);
  const bolt = props.boltDepth ?? 0;
  return (
    <group {...placement(props)}>
      <extrude height={depth + LIFT} z={-depth}>
        <regularPolygon sides={6} flats={af} />
      </extrude>
      {bolt > 0 && <cylinder d={m.clearance[props.fit ?? "normal"]} h={bolt + LIFT} z={-depth - bolt} />}
    </group>
  );
}

/** Props of {@link HeatSetInsert}. */
export interface HeatSetInsertProps extends Placement {
  /** Insert size, `"M2"` to `"M8"`. */
  size: MetricSize;
  /** Pocket diameter, mm (default: common insert recommendation, M3 → 4.0). */
  diameter?: number;
  /** Pocket depth, mm (default: insert length + 0.5 for displaced plastic, M3 → 6.2). */
  depth?: number;
}

/** A blind pocket for a heat-set threaded insert, from z = 0 down. */
export function HeatSetInsert(props: HeatSetInsertProps) {
  const m = metricData(props.size);
  if (!m.insert && (props.diameter === undefined || props.depth === undefined)) {
    throw new RangeError(`<HeatSetInsert> has no default insert size for ${props.size}; give diameter and depth`);
  }
  const d = props.diameter ?? m.insert!.diameter;
  const depth = props.depth ?? m.insert!.length + 0.5;
  positive("HeatSetInsert", "diameter", d);
  positive("HeatSetInsert", "depth", depth);
  return (
    <group {...placement(props)}>
      <cylinder d={d} h={depth + LIFT} z={-depth} />
    </group>
  );
}

/** Props of {@link Standoff}. */
export interface StandoffProps extends Placement {
  /** Screw size, e.g. `"M3"`. */
  size: MetricSize;
  /** Height above z = 0, mm. */
  height: number;
  /** Outer diameter, mm. Default: 2 × nominal + 1 (M3 → 7). */
  od?: number;
  /**
   * The bore: `"tap"` (default, for self-tapping/tapping), `"clearance"`, `"insert"` (a
   * heat-set insert pocket from the top), or `"none"` (solid).
   */
  hole?: "tap" | "clearance" | "insert" | "none";
  /** Bore depth from the top, mm. Default: the whole height. */
  holeDepth?: number;
  /** Hexagonal instead of round (od is then across flats). Default false. */
  hex?: boolean;
}

/** A standoff boss standing on z = 0, with a bore from the top. */
export function Standoff(props: StandoffProps) {
  const m = metricData(props.size);
  const h = props.height;
  positive("Standoff", "height", h);
  const od = props.od ?? 2 * m.d + 1;
  positive("Standoff", "od", od);
  const kind = props.hole ?? "tap";
  const bore = kind === "tap" ? m.tapDrill : kind === "clearance" ? m.clearance.normal : kind === "insert" ? m.insert?.diameter : undefined;
  if (kind === "insert" && bore === undefined) throw new RangeError(`<Standoff> no insert size for ${props.size}`);
  const depth = Math.min(props.holeDepth ?? (kind === "insert" ? m.insert!.length + 0.5 : h), h);
  if (bore !== undefined && bore >= od) throw new RangeError(`<Standoff> od (${od}) must be larger than the bore (${bore})`);
  const body = props.hex ? (
    <extrude height={h}>
      <regularPolygon sides={6} flats={od} />
    </extrude>
  ) : (
    <cylinder d={od} h={h} />
  );
  return (
    <group {...placement(props)}>
      {bore === undefined ? (
        body
      ) : (
        <difference>
          {body}
          <cylinder d={bore} h={depth + LIFT} z={h - depth} />
        </difference>
      )}
    </group>
  );
}
