/**
 * Mounting hole patterns of common boards and motors (published dimensions), and components
 * that repeat a child at a pattern's points.
 */
import type { Children } from "../core/element";
import type { Placement } from "../core/intrinsics";
import { CounterboreHole, CountersinkHole, Hole, TapHole } from "./holes";
import { HeatSetInsert } from "./hardware";
import type { MetricSize } from "./metric";
import { placement } from "./place";

/** `[x, y]`, mm. */
export type Vec2 = [number, number];

/** A mounting hole pattern. Points are relative to the pattern's centre. */
export interface MountPattern {
  /** Display name. */
  name: string;
  /** Hole positions `[x, y]`, mm, about the pattern centre. */
  points: readonly Vec2[];
  /** The screw size the holes take. */
  size: MetricSize;
  /** The mounting holes' own diameter on the device, mm. */
  holeDiameter: number;
  /** The board/face outline `[w, h]`, mm, when it has one. */
  outline?: Vec2;
  /** Where the outline's lower-left corner is, relative to the pattern centre. */
  outlineOffset?: Vec2;
  /** Motors: the centring boss (pilot) diameter, mm. */
  pilot?: number;
}

const square = (pitch: number): Vec2[] => {
  const a = pitch / 2;
  return [[-a, -a], [a, -a], [a, a], [-a, a]];
};

/** Published mounting patterns. */
export const mountPatterns = {
  /** Raspberry Pi 4 / 5 (and 3B/3B+): 58 × 49 mm, M2.5, board 85 × 56 mm. */
  raspberryPi4: {
    name: "Raspberry Pi 4",
    points: [[-29, -24.5], [29, -24.5], [29, 24.5], [-29, 24.5]],
    size: "M2.5",
    holeDiameter: 2.7,
    outline: [85, 56],
    outlineOffset: [-32.5, -28],
  },
  /** Raspberry Pi Zero / Zero 2 W: 58 × 23 mm, M2.5, board 65 × 30 mm. */
  raspberryPiZero: {
    name: "Raspberry Pi Zero",
    points: [[-29, -11.5], [29, -11.5], [29, 11.5], [-29, 11.5]],
    size: "M2.5",
    holeDiameter: 2.7,
    outline: [65, 30],
    outlineOffset: [-32.5, -15],
  },
  /**
   * Arduino Uno R3: holes at (13.97, 2.54), (15.24, 50.8), (66.04, 7.62), (66.04, 35.56) from
   * the board's lower-left corner; board 68.58 × 53.34 mm; M3. Centred on the board.
   */
  arduinoUno: {
    name: "Arduino Uno",
    points: [[-20.32, -24.13], [-19.05, 24.13], [31.75, -19.05], [31.75, 8.89]],
    size: "M3",
    holeDiameter: 3.2,
    outline: [68.58, 53.34],
    outlineOffset: [-34.29, -26.67],
  },
  /** NEMA 17 stepper: 31 mm square, M3, 22 mm pilot, 42.3 mm face. */
  nema17: { name: "NEMA 17", points: square(31), size: "M3", holeDiameter: 3, outline: [42.3, 42.3], outlineOffset: [-21.15, -21.15], pilot: 22 },
  /** NEMA 23 stepper: 47.14 mm square, M5 (Ø 5.1 holes), 38.1 mm pilot, 56.4 mm face. */
  nema23: { name: "NEMA 23", points: square(47.14), size: "M5", holeDiameter: 5.1, outline: [56.4, 56.4], outlineOffset: [-28.2, -28.2], pilot: 38.1 },
} as const satisfies Record<string, MountPattern>;

/** Props of {@link BoltPattern}. */
export interface BoltPatternProps extends Placement {
  /** The pattern (e.g. `mountPatterns.nema17`), or a list of `[x, y]` points. */
  pattern: MountPattern | readonly Vec2[];
  /** What to repeat at every point (holes, standoffs...). */
  children?: Children;
}

/** Repeat the children at every point of a pattern (in XY). */
export function BoltPattern(props: BoltPatternProps) {
  const pts = "points" in props.pattern ? props.pattern.points : props.pattern;
  return (
    <group {...placement(props)}>
      {pts.map(([x, y], i) => (
        <group key={i} x={x} y={y}>
          {props.children}
        </group>
      ))}
    </group>
  );
}

/** Props of {@link MountHoles}. */
export interface MountHolesProps extends Placement {
  /** The pattern; its `size` picks the screw. */
  pattern: MountPattern;
  /** Hole style. Default `"clearance"`. */
  type?: "clearance" | "counterbore" | "countersink" | "tap" | "insert";
  /** Hole depth below z = 0, mm. Default 20 (`insert`: the insert length). */
  depth?: number;
}

/** The pattern's holes as cutting tools (pointing −Z from z = 0). */
export function MountHoles(props: MountHolesProps) {
  const { size } = props.pattern;
  const d = props.depth;
  const tool = (() => {
    switch (props.type ?? "clearance") {
      case "counterbore":
        return <CounterboreHole size={size} {...(d !== undefined ? { depth: d } : {})} />;
      case "countersink":
        return <CountersinkHole size={size} {...(d !== undefined ? { depth: d } : {})} />;
      case "tap":
        return <TapHole size={size} {...(d !== undefined ? { depth: d } : {})} />;
      case "insert":
        return <HeatSetInsert size={size} {...(d !== undefined ? { depth: d } : {})} />;
      default:
        return <Hole size={size} {...(d !== undefined ? { depth: d } : {})} />;
    }
  })();
  return (
    <BoltPattern pattern={props.pattern} {...placement(props)}>
      {tool}
    </BoltPattern>
  );
}
