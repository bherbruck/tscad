/** Stock profiles. */
import type { Placement } from "../core/intrinsics";
import { placement, positive } from "./place";

type Vec2 = [number, number];

/** One side of a 2020 T-slot, drawn on the bottom edge (y = −10) walking +X. */
const SLOT: Vec2[] = [
  [-3.1, -10], [-3.1, -8.2], [-5.5, -8.2], [-5.5, -6.6], [-2.8, -4], [2.8, -4], [5.5, -6.6], [5.5, -8.2], [3.1, -8.2], [3.1, -10],
];

/** The simplified 2020 outline: a 20 mm square with a 6.2 mm T-slot on each side. */
export const extrusion2020Outline: Vec2[] = (() => {
  const pts: Vec2[] = [];
  const rot = (p: Vec2, k: number): Vec2 => {
    const [x, y] = p;
    return k === 0 ? [x, y] : k === 1 ? [-y, x] : k === 2 ? [-x, -y] : [y, -x];
  };
  for (let k = 0; k < 4; k++) {
    pts.push(rot([-10, -10], k));
    for (const p of SLOT) pts.push(rot(p, k));
  }
  return pts;
})();

/** Props of {@link Extrusion2020}. */
export interface Extrusion2020Props extends Placement {
  /** Length along +Z from z = 0, mm. */
  length: number;
  /** Centre bore diameter (M5 tap), mm. Default 4.2; 0 for none. */
  bore?: number;
}

/**
 * A 20 × 20 mm aluminium T-slot extrusion (simplified profile: 6.2 mm slot openings, 1.8 mm
 * lips, trapezoidal slot cavity, Ø 4.2 centre bore; no corner radii or inner webs), standing
 * on z = 0 along +Z, centred in XY.
 */
export function Extrusion2020(props: Extrusion2020Props) {
  positive("Extrusion2020", "length", props.length);
  const bore = props.bore ?? 4.2;
  return (
    <group {...placement(props)}>
      <extrude height={props.length}>
        <polygon points={extrusion2020Outline} />
        {bore > 0 && <circle d={bore} />}
      </extrude>
    </group>
  );
}

/** Props of {@link HexPrism}. */
export interface HexPrismProps extends Placement {
  /** Across flats, mm. */
  af: number;
  /** Height along +Z from z = 0, mm. */
  height: number;
  /** Optional through bore diameter, mm. */
  bore?: number;
}

/** A hexagonal prism (flats parallel to X), centred in XY, base on z = 0. */
export function HexPrism(props: HexPrismProps) {
  positive("HexPrism", "af", props.af);
  positive("HexPrism", "height", props.height);
  if (props.bore !== undefined && !(props.bore > 0 && props.bore < props.af)) throw new RangeError(`<HexPrism> bore must be between 0 and af`);
  return (
    <group {...placement(props)}>
      <extrude height={props.height}>
        <regularPolygon sides={6} flats={props.af} />
        {props.bore !== undefined && <circle d={props.bore} />}
      </extrude>
    </group>
  );
}
