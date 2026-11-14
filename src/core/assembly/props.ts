/**
 * Props of `<anchor>` and `<mate>`. Lengths in mm, angles in degrees.
 */
import type { Key } from "../element";
import type { AnchorRef } from "./refs";

type Vec3 = [number, number, number];
/** A direction: an axis name (optionally negated) or a vector. */
export type Direction = "x" | "y" | "z" | "-x" | "-y" | "-z" | Vec3;

/**
 * A named frame (connector) on a part: an origin and an axis (its local z), plus an x
 * direction. It moves with everything around it, so a component can expose mounting points.
 * Anchors build no geometry.
 * @example <anchor id="shaft" at={[0, 0, 24]} axis="z" />
 */
export interface AnchorProps {
  /** Name, unique within its part: the mate refers to `"part.id"`. */
  id: string;
  /** Origin, mm (default the origin of where the anchor sits). */
  at?: Vec3;
  /** Added to `at[0]`. */
  x?: number;
  /** Added to `at[1]`. */
  y?: number;
  /** Added to `at[2]`. */
  z?: number;
  /** The anchor's axis (its local z). Default `"z"`. */
  axis?: Direction;
  /** The anchor's x direction (projected square to `axis`). Default: X, or Y when `axis` is along X. */
  xAxis?: Direction;
  key?: Key;
}

/** How two anchors are joined (each removes some of the six relative degrees of freedom). */
export type MateType = "fastened" | "revolute" | "slider" | "cylindrical" | "planar" | "ball";

/**
 * Join anchor `b` (its part moves) to anchor `a`. Origins meet, axes align (opposed with
 * `flip`) and, depending on `type`, x directions align:
 *
 * | type | free motion | driven by |
 * |---|---|---|
 * | `fastened` (default) | none | none |
 * | `revolute` | rotation about the axis | `angle` |
 * | `slider` | travel along the axis | `offset` |
 * | `cylindrical` | rotation about + travel along the axis | `angle`, `offset` |
 * | `planar` | travel in the plane, rotation about the normal | `angle` |
 * | `ball` | any rotation about the origin | none |
 */
export interface MateProps {
  /** The first anchor: `"part.anchor"` or a handle (`A.motor.shaft`). */
  a: string | AnchorRef;
  /** The second anchor. */
  b: string | AnchorRef;
  /** Joint type. Default `"fastened"`. */
  type?: MateType;
  /** Offset along `a`'s axis, mm (a slider's travel; a gap for the others). */
  offset?: number;
  /** Alias of `offset`. */
  distance?: number;
  /** Rotation of `b` about `a`'s axis, degrees (a revolute joint's angle). */
  angle?: number;
  /** Axes opposed instead of aligned (face-to-face). */
  flip?: boolean;
  /** Name, for `<gear>`s relating this joint to another. */
  id?: string;
  /**
   * Allowed range of the joint, `[min, max]`: degrees for revolute/cylindrical/planar
   * (the angle), mm for a slider (the offset). Out-of-range positions warn.
   */
  limits?: [number, number];
  key?: Key;
}

/**
 * Couples two revolute (or cylindrical) joints: `b`'s angle = `ratio` × `a`'s angle + `phase`.
 * Negative ratios turn the other way (meshing spur gears).
 * @example <gear a="motor" b="wheel" ratio={-0.5} />
 */
export interface GearProps {
  /** `id` of the driving mate. */
  a: string;
  /** `id` of the driven mate. */
  b: string;
  /** b's angle per degree of a's. */
  ratio: number;
  /** Angle offset, degrees. */
  phase?: number;
  key?: Key;
}

export interface AssemblyElements {
  /** A named frame on a part, for mates. */
  anchor: AnchorProps;
  /** A joint between two anchors (inside `<assembly>`). */
  mate: MateProps;
  /** Couples two joints' angles (inside `<assembly>`). */
  gear: GearProps;
}
