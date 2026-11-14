/**
 * Props of the constraint-sketch elements (`<point>`, `<line>`, `<arc>`, constraints...).
 * They live inside `<sketch>`; any of them turns that sketch into a solved, constraint-based
 * sketch. Lengths in mm, angles in degrees.
 */
import type { Key } from "../element";
import type { ArcHandle, CircleHandle, LineHandle, PointHandle, SketchRef, SplineHandle } from "./refs";

type Vec2 = [number, number];

/**
 * A point: an id (`"o"`), an entity's point (`"base.start"`, `"base.end"`, `"top.center"`),
 * a handle (`s.o`, `s.base.end`), or — where a point is being created — `[x, y]` (a new
 * anonymous point with that rough position).
 */
export type PointLike = string | PointHandle | Vec2;
/** A point named by id or handle (no coordinates). */
export type PointId = string | PointHandle;
/** An id or a handle of one of the kinds `H`. */
export type Ref<H> = string | H;
/** One reference or several. */
export type Refs<H> = Ref<H> | readonly Ref<H>[];
type Round = ArcHandle | CircleHandle;
type AnyCurve = LineHandle | ArcHandle | CircleHandle | SplineHandle;
/** Anything in a sketch: a point or a curve, by id or handle. */
export type ThingRef = string | SketchRef;

interface Common {
  /** Reconciliation key (diagnostics only). */
  key?: Key;
}
interface Entity<H> extends Common {
  /** Name to reference this entity from constraints (`tangent="base"`). */
  id?: string;
  /** A handle naming this entity (`ref={s.base}`), the typed alternative to `id`. */
  ref?: H;
  /** Construction geometry: constrains, but is not part of the profile. */
  construction?: boolean;
}

/** A sketch point. `x`/`y` are a rough guess unless `fixed`. */
export interface PointProps extends Common {
  id?: string;
  /** A handle naming this point (`ref={s.o}`). */
  ref?: PointHandle;
  /** Rough (or, with `fixed`, exact) X, mm. */
  x?: number;
  /** Rough (or, with `fixed`, exact) Y, mm. */
  y?: number;
  /** `[x, y]` (alias of `x`/`y`). */
  at?: Vec2;
  /** Pin the point at `x`, `y` (default 0, 0). */
  fixed?: boolean;
  /** Keep the point on this curve (line, arc or circle). */
  on?: Ref<LineHandle | Round>;
}

/** Line-ish constraint props shared by `<line>`. */
export interface LineProps extends Entity<LineHandle> {
  /** Start point: an id (created if new) or `[x, y]`. */
  from: PointLike;
  /** End point: an id (created if new) or `[x, y]`. */
  to: PointLike;
  /** Keep the line horizontal. */
  horizontal?: boolean;
  /** Keep the line vertical. */
  vertical?: boolean;
  /** Length, mm. */
  length?: number;
  /** Direction from `from` to `to`, degrees CCW from +X (lines are undirected: mod 180). */
  angle?: number;
  /** Parallel to these lines. */
  parallel?: Refs<LineHandle>;
  /** Perpendicular to these lines. */
  perpendicular?: Refs<LineHandle>;
  /** Same length as these lines. */
  equal?: Refs<LineHandle>;
  /** Tangent to these arcs/circles (`true`: the arc meeting this line's `from`). */
  tangent?: Refs<Round> | boolean;
}

/**
 * A circular arc from `from` to `to`, counter-clockwise about `center` unless `cw`.
 * Give `center` (an id) or leave it out and set `radius` / `tangent`: the centre is then
 * an implicit point (`"<id>.center"`).
 */
export interface ArcProps extends Entity<ArcHandle> {
  /** Start point. */
  from: PointLike;
  /** End point. */
  to: PointLike;
  /** Centre point (created if new). */
  center?: PointLike;
  /** Radius, mm. */
  radius?: number;
  /** Alias of `radius`. */
  r?: number;
  /** Diameter, mm. */
  diameter?: number;
  /** Alias of `diameter`. */
  d?: number;
  /** Clockwise from `from` to `to`. Default: counter-clockwise (or as drawn, for tangent arcs). */
  cw?: boolean;
  /** Explicitly counter-clockwise. */
  ccw?: boolean;
  /** Sweep angle, degrees (constrained). */
  angle?: number;
  /** Tangent to these lines/arcs/circles; `true`: to the curve meeting this arc's `from`. */
  tangent?: Refs<LineHandle | Round> | boolean;
  /** Same radius as these arcs/circles. */
  equal?: Refs<Round>;
  /** Same centre as this arc/circle. */
  concentric?: Ref<Round>;
}

/**
 * Inside a constraint sketch, `<circle>` is a solved circle: `center` an id or `[x, y]` (or
 * `x`/`y` as the rough centre), radius optional (then it's free).
 */
export interface SketchCircleProps extends Entity<CircleHandle> {
  /** Centre point id (created if new) or `[x, y]` guess. */
  center?: PointLike;
  /** Pin the centre where drawn. */
  fixed?: boolean;
  /** Tangent to these lines/arcs/circles. */
  tangent?: Refs<LineHandle | Round>;
  /** Same radius as these arcs/circles. */
  equal?: Refs<Round>;
  /** Same centre as this arc/circle. */
  concentric?: Ref<Round>;
}

/** A clamped B-spline through control points (ends on the first and last). */
export interface SplineProps extends Entity<SplineHandle> {
  /** Control points: ids (created if new) or `[x, y]`, at least 2. */
  points: readonly PointLike[];
  /** Degree (default 3, lowered for few points). */
  degree?: number;
}

/** Two things a constraint relates. `from`/`to` are aliases of `a`/`b`. */
interface Pair<H = SketchRef> extends Common {
  a?: Ref<H>;
  b?: Ref<H>;
  from?: Ref<H>;
  to?: Ref<H>;
}

/**
 * A driving dimension. Between two points: `distance` (or `dx` / `dy`, signed b − a);
 * point–line: perpendicular distance; line–line: distance between (and so parallel) lines;
 * an arc/circle stands for its centre. `of` + `radius`/`diameter` for circles, `of` +
 * `length` for lines, `a`/`b` + `angle` for two lines.
 */
export interface DimensionProps extends Pair {
  /** Distance, mm. */
  distance?: number;
  /** Alias of `distance`. */
  value?: number;
  /**
   * For a distance from a line: which side of it (looking from its `from` to its `to`) the
   * other point/line lies. Default: the side it is drawn on.
   */
  side?: "left" | "right";
  /** Signed horizontal distance `b.x − a.x`, mm. */
  dx?: number;
  /** Signed vertical distance `b.y − a.y`, mm. */
  dy?: number;
  /** Angle from line a to line b, degrees CCW (mod 180). */
  angle?: number;
  /** The entity for `radius` / `diameter` / `length`. */
  of?: Ref<AnyCurve>;
  radius?: number;
  diameter?: number;
  length?: number;
}
/** Distance between two things (see `<dimension>`). */
export interface DistanceProps extends Pair {
  /** Distance, mm. */
  value?: number;
  /** For a distance from a line: `"left"` / `"right"` of it (from → to). Default: as drawn. */
  side?: "left" | "right";
  /** Alias of `value`. */
  distance?: number;
  dx?: number;
  dy?: number;
}
/** Angle from line `a` to line `b`, degrees CCW (lines undirected: mod 180). */
export interface AngleProps extends Pair<LineHandle> {
  value?: number;
  angle?: number;
}
/** Two points made one, or a point put on a curve. */
export interface CoincidentProps extends Pair {}
/** Equal length (lines) or radius (arcs/circles); `of` for several. */
export interface EqualProps extends Pair<LineHandle | Round> {
  of?: readonly Ref<LineHandle | Round>[];
}
/** Two lines parallel (`of` for several). */
export interface ParallelProps extends Pair<LineHandle> {
  of?: readonly Ref<LineHandle>[];
}
/** Two lines perpendicular. */
export interface PerpendicularProps extends Pair<LineHandle> {}
/** Tangent: line–arc/circle or arc/circle–arc/circle. */
export interface TangentProps extends Pair<LineHandle | Round> {}
/** Lines on one infinite line. */
export interface CollinearProps extends Pair<LineHandle> {}
/** Same centre. */
export interface ConcentricProps extends Pair<Round> {}
/** A line (`a`) or two points (`a`, `b`) horizontal. */
export interface HorizontalProps extends Pair<LineHandle | PointHandle> {}
/** A line (`a`) or two points (`a`, `b`) vertical. */
export interface VerticalProps extends Pair<LineHandle | PointHandle> {}
/**
 * `a` and `b` mirror images: across line `about`; about point `about` (point symmetry); or,
 * with `axis`, across the vertical (`"x"`: x mirrored) or horizontal (`"y"`) line through
 * point `about` (default the origin).
 */
export interface SymmetricProps extends Pair<PointHandle | Round> {
  about?: Ref<PointHandle | LineHandle>;
  axis?: "x" | "y";
}
/** `point` at the middle of line `of`. */
export interface MidpointProps extends Common {
  point: PointId;
  of: Ref<LineHandle>;
}
/** `point` on curve `curve` (line: the infinite line; arc: its circle). */
export interface OnCurveProps extends Common {
  point: PointId;
  curve: Ref<LineHandle | Round>;
}
/** Pin a point (at `x`/`y`, or where it is drawn). */
export interface FixProps extends Common {
  point?: PointId;
  a?: PointId;
  x?: number;
  y?: number;
}

/** The constraint-sketch elements, merged into `IntrinsicElements`. */
export interface ConstraintSketchElements {
  /** Constraint sketch: a point. */
  point: PointProps;
  /** Constraint sketch: a line between two points. */
  line: LineProps;
  /** Constraint sketch: a circular arc. */
  arc: ArcProps;
  /** Constraint sketch: a B-spline through control points. */
  spline: SplineProps;
  /** Constraint sketch: a driving dimension. */
  dimension: DimensionProps;
  /** Constraint sketch: a distance. */
  distance: DistanceProps;
  /** Constraint sketch: an angle between lines. */
  angle: AngleProps;
  /** Constraint sketch: coincident points / point on curve. */
  coincident: CoincidentProps;
  /** Constraint sketch: equal lengths / radii. */
  equal: EqualProps;
  /** Constraint sketch: parallel lines. */
  parallel: ParallelProps;
  /** Constraint sketch: perpendicular lines. */
  perpendicular: PerpendicularProps;
  /** Constraint sketch: tangency. */
  tangent: TangentProps;
  /** Constraint sketch: collinear lines. */
  collinear: CollinearProps;
  /** Constraint sketch: concentric arcs/circles. */
  concentric: ConcentricProps;
  /** Constraint sketch: horizontal. */
  horizontal: HorizontalProps;
  /** Constraint sketch: vertical. */
  vertical: VerticalProps;
  /** Constraint sketch: symmetry. */
  symmetric: SymmetricProps;
  /** Constraint sketch: midpoint. */
  midpoint: MidpointProps;
  /** Constraint sketch: point on curve. */
  onCurve: OnCurveProps;
  /** Constraint sketch: fix a point. */
  fix: FixProps;
}

/** Extra `<sketch>` props for constraint sketches. */
export interface ConstraintSketchOptions {
  /** Make an under-constrained sketch an error instead of a warning. */
  strict?: boolean;
  /** Don't warn about remaining degrees of freedom. */
  allowFree?: boolean;
}
