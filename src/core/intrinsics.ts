/**
 * Props of every intrinsic element — this file is what users see in their editor.
 *
 * Units: lengths in **millimetres**, angles in **degrees** (use `inch()` / `rad()` to convert).
 */
import type { Axis, Selector } from "../ir";
import type { Children, Key } from "./element";
import type { MaterialName } from "./materials";
import type { Path3 } from "./paths";
import type { SelectorLike } from "./select";
import type { AssemblyElements } from "./assembly/props";
import type { ConstraintSketchElements, ConstraintSketchOptions, SketchCircleProps } from "./sketch/constrained-props";

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** Children that build solids (primitives, booleans, extrudes, components...). */
export interface SolidChildren {
  /** The solids this element operates on (several are unioned). */
  children?: Children;
}
/** Children that are 2D sketch shapes (`<rect>`, `<circle>`, `<path>`...). */
export interface SketchChildren {
  /** 2D sketch shapes. Closed loops nested inside others become holes (even-odd). */
  children?: Children;
}

/**
 * Where a solid goes. Applied in this order: `mirror`, `scale`, `rotate` (+ `rotateX/Y/Z`),
 * then the translation (`at` + `x`/`y`/`z`). Available on every solid-producing element.
 */
export interface Placement {
  /** Move along X, mm (added to `at`). */
  x?: number;
  /** Move along Y, mm (added to `at`). */
  y?: number;
  /** Move along Z, mm (added to `at`). */
  z?: number;
  /** Move by `[x, y, z]`, mm. */
  at?: Vec3;
  /**
   * Rotate `[rx, ry, rz]` degrees about the fixed X, then Y, then Z axes (OpenSCAD's
   * `rotate([rx, ry, rz])`), about the origin, before translating.
   */
  rotate?: Vec3;
  /** Rotate about X, degrees (added to `rotate[0]`). */
  rotateX?: number;
  /** Rotate about Y, degrees (added to `rotate[1]`). */
  rotateY?: number;
  /** Rotate about Z, degrees (added to `rotate[2]`). */
  rotateZ?: number;
  /** Uniform scale factor about the origin. */
  scale?: number;
  /** Mirror across the plane through the origin square to this axis (`"x"` negates X). */
  mirror?: Axis;
  /** Reconciliation key (like React's); tscad only uses it for diagnostics. */
  key?: Key;
}

/**
 * Per-axis centring: `true` centres on the origin in every axis, `false` puts the lower
 * corner on the origin, `[cx, cy, cz]` chooses per axis.
 */
export type CenterSpec = boolean | [boolean, boolean, boolean];

// ---------------------------------------------------------------------------------------------
// Containers

export interface AssemblyProps extends Placement, SolidChildren {
  /** Don't warn about parts their mates leave free to move. */
  allowFree?: boolean;
  /** Mates must fix every part (free parts are errors) and redundant mates are reported. */
  strict?: boolean;
  /** As a sub-assembly: ground it in the parent assembly's mates. */
  fixed?: boolean;
  /** Assembly name (used as a prefix for loose solids' part name). */
  name?: string;
}

export interface PartProps extends Placement, SolidChildren {
  /** Part name: unique within the model; used for meshes, STEP entities and export files. */
  name?: string;
  /** Display colour, any CSS colour (default: from `material`). */
  color?: string;
  /**
   * Material preset (`"pla"`, `"petg"`, `"abs"`, `"aluminum"`, `"steel"`, `"brass"`,
   * `"wood"`...), giving a default colour and density. See `materials`.
   */
  material?: MaterialName | (string & {});
  /** Density in g/cm³ for mass estimates (default: from `material`). */
  density?: number;
  /** `false` leaves the part out of the document (and exports); default true. */
  visible?: boolean;
  /** Ground this part for `<mate>`s: it never moves (default: the first part is grounded). */
  fixed?: boolean;
}

/**
 * A flat 2D part for laser cutting / CNC: its 2D shapes compile straight to loops (no kernel)
 * and export to DXF/SVG with `tscad/drawing`. Give it a `thickness` to also get a 3D part
 * (the sheet, extruded up from z = 0) for the viewer and STEP/STL.
 * @example <drawing name="gasket" thickness={1.5}><rect w={50} h={30} /><circle r={8} /></drawing>
 */
export interface DrawingProps extends Placement2D, SketchChildren {
  /** Drawing (and part) name; unique. Default `"drawing"`. */
  name?: string;
  /** Sheet thickness, mm: also emit the drawing as an extruded part. */
  thickness?: number;
  /** Display colour of the part. */
  color?: string;
  /** Material preset of the part (see `<part material>`). */
  material?: MaterialName | (string & {});
  /** Density override, g/cm³. */
  density?: number;
}

export interface GroupProps extends Placement, SolidChildren {
  /** Optional label (diagnostics only). */
  name?: string;
}

// ---------------------------------------------------------------------------------------------
// Explicit transforms

export interface TranslateProps extends SolidChildren {
  /** Offset along X, mm. */
  x?: number;
  /** Offset along Y, mm. */
  y?: number;
  /** Offset along Z, mm. */
  z?: number;
  /** Offset `[x, y, z]`, mm (added to `x`/`y`/`z`). */
  by?: Vec3;
}

export interface RotateProps extends SolidChildren {
  /** Angle about X, degrees (applied first). */
  x?: number;
  /** Angle about Y, degrees (applied second). */
  y?: number;
  /** Angle about Z, degrees (applied third). */
  z?: number;
  /** `[rx, ry, rz]` degrees, X then Y then Z (added to `x`/`y`/`z`). */
  by?: Vec3;
  /** Rotate by `angle` about this axis instead (right-hand rule). */
  axis?: Vec3 | Axis;
  /** Angle about `axis`, degrees. */
  angle?: number;
  /** Rotate about this point instead of the origin. */
  origin?: Vec3;
}

export interface ScaleProps extends SolidChildren {
  /**
   * Scale factor: a number (uniform) or `[sx, sy, sz]`. Non-uniform scale turns analytic
   * surfaces (cylinders, spheres) into NURBS.
   */
  by: number | Vec3;
  /** Scale about this point instead of the origin. */
  origin?: Vec3;
}

export interface MirrorProps extends SolidChildren {
  /** The plane to mirror across, by its normal: an axis (`"x"` negates X) or a vector. */
  axis: Axis | Vec3;
  /** Keep the original as well as the mirrored copy (a symmetric pair). Default false. */
  keep?: boolean;
  /** A point on the mirror plane (default origin). */
  origin?: Vec3;
}

// ---------------------------------------------------------------------------------------------
// Primitives

/**
 * A rectangular box. **Default placement: centred in X and Y, base on z = 0** (ready to
 * print). Size by `size`, or `width`/`depth`/`height` (aliases `w`/`d`/`h`).
 */
export interface BoxProps extends Placement {
  /** `[x, y, z]` mm, or one number for a cube. */
  size?: number | Vec3;
  /** Size along X, mm. */
  width?: number;
  /** Size along Y, mm. */
  depth?: number;
  /** Size along Z, mm. */
  height?: number;
  /** Alias of `width`. */
  w?: number;
  /** Alias of `depth`. */
  d?: number;
  /** Alias of `height`. */
  h?: number;
  /** Centring per axis. Default `[true, true, false]` (centred XY, base on z = 0). */
  center?: CenterSpec;
}

/**
 * A cylinder about +Z. **Default placement: axis on Z, base on z = 0.**
 * Radius by `r`/`radius` or `d`/`diameter`; height by `h`/`height`.
 */
export interface CylinderProps extends Placement {
  /** Radius, mm. */
  r?: number;
  /** Radius, mm (alias of `r`). */
  radius?: number;
  /** Diameter, mm. */
  d?: number;
  /** Diameter, mm (alias of `d`). */
  diameter?: number;
  /** Height along +Z, mm. */
  h?: number;
  /** Height along +Z, mm (alias of `h`). */
  height?: number;
  /** Centring per axis. Default `[true, true, false]`; `true` also centres in Z. */
  center?: CenterSpec;
}

/**
 * A cone or frustum about +Z, from radius `r1` at the base to `r2` at the top (either may be
 * 0). **Default placement: axis on Z, base on z = 0.**
 */
export interface ConeProps extends Placement {
  /** Bottom radius, mm. */
  r1?: number;
  /** Top radius, mm (0 for a point). */
  r2?: number;
  /** Bottom diameter, mm. */
  d1?: number;
  /** Top diameter, mm. */
  d2?: number;
  /** Height along +Z, mm. */
  h?: number;
  /** Height along +Z, mm (alias of `h`). */
  height?: number;
  /** Centring per axis. Default `[true, true, false]`. */
  center?: CenterSpec;
}

/** A sphere, **centred on the origin** by default. */
export interface SphereProps extends Placement {
  /** Radius, mm. */
  r?: number;
  /** Radius, mm (alias of `r`). */
  radius?: number;
  /** Diameter, mm. */
  d?: number;
  /** Diameter, mm (alias of `d`). */
  diameter?: number;
  /** Centring per axis. Default `true`; `false` puts the bounding box's corner on the origin. */
  center?: CenterSpec;
}

/** A torus about +Z, **centred on the origin**. */
export interface TorusProps extends Placement {
  /** Major radius (centre to tube centre), mm. */
  R?: number;
  /** Minor radius (tube radius), mm. */
  r?: number;
  /** Major radius, mm (alias of `R`). */
  major?: number;
  /** Minor radius, mm (alias of `r`). */
  minor?: number;
}

/**
 * An imported STEP solid (exact B-rep), placed like any other solid. Get the text with an
 * import attribute: `import bracket from "./bracket.step" with { type: "text" }`.
 * Analytic models round-trip; some blended (filleted) files can't be read yet.
 */
export interface StepProps extends Placement {
  /** The STEP file's text (ISO-10303-21). */
  data: string;
  /** Which solid of the file, 0-based (default: all solids, unioned). */
  solid?: number;
}

// ---------------------------------------------------------------------------------------------
// Booleans

/** Everything in any child. */
export interface UnionProps extends Placement, SolidChildren {}
/** The first child minus every other child. */
export interface DifferenceProps extends Placement, SolidChildren {}
/** Only what every child shares. */
export interface IntersectionProps extends Placement, SolidChildren {}

// ---------------------------------------------------------------------------------------------
// Sketch (2D) shapes — children of <extrude>, <revolve>, <loft>, <sweep>

/**
 * Where a 2D shape goes in its sketch: mirror, then rotate, then translate.
 */
export interface Placement2D {
  /** Move along sketch X, mm. */
  x?: number;
  /** Move along sketch Y, mm. */
  y?: number;
  /** Move by `[x, y]`, mm (added to `x`/`y`). */
  at?: Vec2;
  /** Rotate CCW about the sketch origin, degrees (before translating). */
  rotate?: number;
  /** Mirror: `"x"` negates sketch X, `"y"` negates sketch Y. */
  mirror?: "x" | "y";
  /** Inside `<loft>`: the height of this section, mm. */
  z?: number;
  /** Reconciliation key (diagnostics only). */
  key?: Key;
}

/** A rectangle, **centred** on its position by default. */
export interface RectProps extends Placement2D {
  /** Width (sketch X), mm. */
  w?: number;
  /** Height (sketch Y), mm. */
  h?: number;
  /** Alias of `w`. */
  width?: number;
  /** Alias of `h`. */
  height?: number;
  /** `[w, h]`, or one number for a square. */
  size?: number | Vec2;
  /** `false` puts the lower-left corner on the position instead. Default true. */
  center?: boolean;
}

/** A rectangle with rounded corners (exact quarter arcs), centred. */
export interface RoundedRectProps extends RectProps {
  /** Corner radius, mm (clamped to half the shorter side). */
  r?: number;
  /** Alias of `r`. */
  radius?: number;
}

/**
 * A circle (one exact arc), centred on its position. Inside a constraint sketch it is a
 * solved circle (`center`, `tangent`, `equal`...).
 */
export interface CircleProps extends Placement2D, SketchCircleProps {
  /** Radius, mm. */
  r?: number;
  /** Radius, mm (alias of `r`). */
  radius?: number;
  /** Diameter, mm. */
  d?: number;
  /** Diameter, mm (alias of `d`). */
  diameter?: number;
}

/** An ellipse (one exact rational NURBS), centred. */
export interface EllipseProps extends Placement2D {
  /** Semi-axis along sketch X, mm. */
  rx: number;
  /** Semi-axis along sketch Y, mm. */
  ry: number;
}

/** A polygon through `points` (closed automatically). */
export interface PolygonProps extends Placement2D {
  /** Vertices `[x, y]` in order (either winding). */
  points: readonly Vec2[];
}

/** A regular polygon (hexagon, ...), centred, first vertex on +X. */
export interface RegularPolygonProps extends Placement2D {
  /** Number of sides (≥ 3). */
  sides: number;
  /** Circumradius (centre to vertex), mm. */
  r?: number;
  /** Circumradius, mm (alias of `r`). */
  radius?: number;
  /** Inradius (centre to flat), mm — e.g. half a hex nut's across-flats size. */
  apothem?: number;
  /** Across-flats width, mm (= 2 × apothem). */
  flats?: number;
}

/** A stadium / slot (two half circles joined by straight sides) along sketch X, centred. */
export interface SlotProps extends Placement2D {
  /** Overall length end to end, mm. */
  length: number;
  /** Width (= end diameter), mm. */
  width: number;
}

/**
 * An SVG-style path. Supports `M L H V C S Q T A Z` (absolute and relative). Each subpath
 * must be closed (`Z`, or end where it began); subpaths nested in others become holes.
 * Note: y points **up** (no SVG flip).
 */
export interface PathProps extends Placement2D {
  /** Path data, e.g. `"M0 0 H20 V10 A5 5 0 0 1 10 10 Z"`. */
  d: string;
}

/** A star with `points` tips, first tip on +Y, centred. */
export interface StarProps extends Placement2D {
  /** Number of tips (≥ 2). */
  points: number;
  /** Tip radius, mm. */
  r1: number;
  /** Valley radius, mm. */
  r2: number;
}

/**
 * Text outlines, for embossing (`<extrude>`) or engraving (`<difference>`). Glyph holes
 * (o, a, e...) are handled like any nested loop. By default the first baseline starts at the
 * position (`align="left"`, `valign="baseline"`); `\n` starts a new line.
 * @example <extrude height={1}><text size={8} align="center" valign="middle">tscad</text></extrude>
 */
export interface TextProps extends Placement2D {
  /** The text: strings and numbers (`<text>v{version}</text>`). */
  children?: string | number | bigint | boolean | null | undefined | readonly (string | number | bigint | boolean | null | undefined)[];
  /**
   * Font size (em), mm. Default 10. In the default font capitals are about 0.73 × size tall
   * and lowercase x about 0.55 × size.
   */
  size?: number;
  /**
   * A TTF/OTF/WOFF font's bytes (e.g. `import f from "./Font.ttf" with { type: "file" }` then
   * read it, or `await Bun.file(...).arrayBuffer()`), or an opentype.js `Font`. Default: the
   * built-in DejaVu Sans (Latin, Greek and common symbols such as ° ± × µ ⌀ Ø).
   */
  font?: ArrayBuffer | Uint8Array | object;
  /** Horizontal alignment of each line about the position. Default `"left"`. */
  align?: "left" | "center" | "right";
  /**
   * Vertical alignment of the block: `"baseline"` (default: first baseline at the position),
   * `"top"` (ascender), `"middle"` (centre of the capitals), `"bottom"` (last descender).
   */
  valign?: "baseline" | "top" | "middle" | "bottom";
  /** Letter advance multiplier (1 = the font's own spacing; 1.2 = 20 % looser). */
  spacing?: number;
  /** Line pitch as a multiple of `size`. Default 1.2. */
  lineHeight?: number;
  /** Apply the font's kerning. Default true. */
  kerning?: boolean;
  /** Apply standard ligatures (fi, fl...). Default true. */
  ligatures?: boolean;
}

/**
 * Offsets its 2D children: positive `distance` grows the shapes (clearance outlines,
 * gaskets), negative shrinks them (insets, pockets). Holes move the other way, so the material
 * grows/shrinks consistently. Lines and arcs stay exact; NURBS (ellipses, text, Béziers) are
 * flattened to lines first. Holes that close up and islands that shrink away are removed.
 * @example <extrude height={2}><offset distance={1.5}><path d={outline} /></offset></extrude>
 */
export interface OffsetProps extends Placement2D, SketchChildren {
  /** Offset distance, mm: positive outward, negative inward. */
  distance?: number;
  /** Alias of `distance`. */
  d?: number;
  /** Round convex corners with exact arcs (default true); `false` mitres them. */
  round?: boolean;
}

/**
 * Groups 2D shapes to place them together. With `<point>`, `<line>`, `<arc>` and constraints
 * inside, it is a **constraint sketch**: solved, then its closed loops become profiles.
 */
export interface SketchProps extends Placement2D, SketchChildren, ConstraintSketchOptions {}

/** A loft section: one 2D shape at height `z`. */
export interface SectionProps extends SketchChildren {
  /** Height of the section, mm. */
  z: number;
  /** Reconciliation key (diagnostics only). */
  key?: Key;
}

// ---------------------------------------------------------------------------------------------
// Sketch → solid

/**
 * Extrude 2D shapes into a solid. Every closed loop is extruded; loops nested inside an odd
 * number of others are **holes**, and disjoint outlines are unioned:
 * `<extrude height={5}><rect w={40} h={30}/><circle r={5}/></extrude>` is a plate with a hole.
 */
export interface ExtrudeProps extends Placement, SketchChildren {
  /** Distance along the sketch normal, mm (negative extrudes the other way). */
  height?: number;
  /** Alias of `height`. */
  h?: number;
  /** Alias of `height`. */
  distance?: number;
  /** Taper angle, degrees: positive narrows the outline as it rises (mould draft). */
  draft?: number;
  /**
   * Sketch plane. `"XY"` (default): normal +Z. `"XZ"`: sketch x → X, y → Z, normal −Y.
   * `"YZ"`: sketch x → Y, y → Z, normal +X.
   */
  plane?: "XY" | "XZ" | "YZ";
  /** Offset of the sketch plane along its normal, mm. */
  offset?: number;
  /** Extrude symmetrically about the sketch plane. Default false. */
  center?: boolean;
}

/**
 * Revolve 2D shapes about the Z axis: sketch x is the **radius**, sketch y is the **height**
 * (the profile is placed in the XZ plane). Keep the profile at x ≥ 0.
 */
export interface RevolveProps extends Placement, SketchChildren {
  /** Sweep angle, degrees (0 < angle ≤ 360). Default 360. */
  angle?: number;
}

/**
 * Skin through 2D sections stacked along Z. Give each shape a `z`, or wrap each in
 * `<section z={...}>`. One loop per section, bottom to top.
 */
export interface LoftProps extends Placement, SketchChildren {
  /** Straight (ruled) walls between sections instead of a smooth skin. Default false. */
  ruled?: boolean;
}

/**
 * Sweep one 2D profile along a 3D path. The profile is placed at the path's start, square
 * to it: sketch y is the up direction (+Z projected onto that plane, or +Y for a vertical
 * start), sketch x completes a right-handed frame with the path's direction.
 */
export interface SweepProps extends Placement, SketchChildren {
  /** The path: `helix({...})`, `polyline3([...])`, `arc3({...})`, or IR curves. */
  path: Path3 | readonly Vec3[];
  /**
   * `"follow"` (default) turns the profile with the path; `"translate"` keeps its
   * orientation (no twist — for threads along a helix, follow is usually right).
   */
  frame?: "follow" | "translate";
}

// ---------------------------------------------------------------------------------------------
// Patterns

/** `count` copies, each moved by `step` from the last. */
export interface LinearPatternProps extends Placement, SolidChildren {
  /** Number of copies (including the original). */
  count: number;
  /** Offset between copies `[dx, dy, dz]`, mm. */
  step?: Vec3;
  /** X offset between copies, mm. */
  dx?: number;
  /** Y offset between copies, mm. */
  dy?: number;
  /** Z offset between copies, mm. */
  dz?: number;
  /** Centre the pattern on the original position. Default false. */
  center?: boolean;
}

/** An `nx` × `ny` grid of copies in XY. */
export interface GridPatternProps extends Placement, SolidChildren {
  /** Columns (along X). */
  nx: number;
  /** Rows (along Y). */
  ny: number;
  /** Column spacing, mm. */
  dx: number;
  /** Row spacing, mm. */
  dy: number;
  /** Centre the grid on the original position. Default true. */
  center?: boolean;
}

/** `count` copies rotated about an axis through the origin. */
export interface PolarPatternProps extends Placement, SolidChildren {
  /** Number of copies (including the original). */
  count: number;
  /**
   * Total angle, degrees. 360 (default) spaces copies evenly around the circle; anything
   * less puts the first copy at 0 and the last at `angle`.
   */
  angle?: number;
  /** Rotation axis. Default `"z"`. */
  axis?: Axis;
  /** Move the children out along +X by this radius first, mm (bolt circles). */
  radius?: number;
  /** Angle of the first copy, degrees. Default 0. */
  startAngle?: number;
}

// ---------------------------------------------------------------------------------------------
// Features

/** Round edges of the children (unioned). `radius` 0 skips the fillet (handy for params). */
export interface FilletProps extends Placement, SolidChildren {
  /** Fillet radius, mm. */
  radius?: number;
  /** Alias of `radius`. */
  r?: number;
  /**
   * Which edges: `edges.top()`, `">Z or |Z"`, or an IR selector. Default: all edges.
   * The kernel fails if nothing matches.
   */
  edges?: SelectorLike | Selector;
}

/** Bevel edges of the children (unioned). `distance` 0 skips it. */
export interface ChamferProps extends Placement, SolidChildren {
  /** Setback along each face, mm. */
  distance?: number;
  /** Alias of `distance`. */
  d?: number;
  /** Which edges (see `fillet`). Default: all edges. */
  edges?: SelectorLike | Selector;
}

/** Hollow the children (unioned) to a wall `thickness`, leaving the `open` faces open. */
export interface ShellProps extends Placement, SolidChildren {
  /** Wall thickness, mm. Walls grow inward unless `outward` (the sign is ignored: −2 is also 2 mm inward). */
  thickness: number;
  /** Faces to remove: `faces.top()`, `">Z"`, ... Default: none (a closed hollow). */
  open?: SelectorLike | Selector;
  /** Grow the walls outward (keep the inside size). Default false. */
  outward?: boolean;
}

/** A plane: `"XY"` (normal +Z), `"XZ"` (normal +Y), `"YZ"` (normal +X), or a point and normal. */
export type PlaneSpec = "XY" | "XZ" | "YZ" | { origin?: Vec3; normal: Vec3 | Axis };

/**
 * Mould draft: tilt the selected faces of the children (unioned) by `angle` so the part
 * releases from a mould pulled along `pull`. Faces pivot about the neutral plane (default
 * z = 0, square to `pull`); a positive angle leans them in as they rise along `pull`.
 * @example <draft angle={3}><box size={[40, 30, 20]} /></draft>
 */
export interface DraftProps extends Placement, SolidChildren {
  /** Draft angle, degrees (0 skips it). */
  angle: number;
  /** Faces to draft. Default: the walls square to `pull` (`"#Z"` for the default pull). */
  faces?: SelectorLike | Selector;
  /** Neutral plane: a height along `pull` (mm), or a plane. Default 0. */
  neutral?: number | PlaneSpec;
  /** Mould pull direction: an axis (`"z"`, `"-z"`) or a vector. Default `"z"`. */
  pull?: Axis | `-${Axis}` | Vec3;
}

/**
 * Push or pull faces: move the selected faces of the children (unioned) along their normals
 * by `distance` (negative: inward); neighbouring faces stretch or shrink to meet them.
 * `distance={0}` skips it.
 * @example <pushPull distance={2} faces=">Z"><box size={10} /></pushPull> // 10 × 10 × 12
 */
export interface PushPullProps extends Placement, SolidChildren {
  /** How far to move the faces, mm (negative: into the solid). Give this or `d`. */
  distance?: number;
  /** Alias of `distance`. */
  d?: number;
  /** Faces to move: `faces.top()`, `">Z"`, ... */
  faces: SelectorLike | Selector;
}

/**
 * Cut the children (unioned) with a plane and keep one side — section views, halves for
 * printing, flat bottoms.
 * @example <split plane="XY" offset={5}><sphere r={10} /></split> // the cap above z = 5
 */
export interface SplitProps extends Placement, SolidChildren {
  /** The cutting plane (in the children's own coordinates). Default `"XY"`. */
  plane?: PlaneSpec;
  /** Move the plane along its normal, mm. */
  offset?: number;
  /** Keep the side the normal points to (`"above"`, default) or the other (`"below"`). */
  keep?: "above" | "below";
}

// ---------------------------------------------------------------------------------------------

/** Every intrinsic element and its props. */
export interface IntrinsicElements extends ConstraintSketchElements, AssemblyElements {
  /** A collection of parts (may nest); placement props move every part in it. */
  assembly: AssemblyProps;
  /** One named, coloured solid — the unit of export. Several children are unioned. */
  part: PartProps;
  /** Groups solids (unioned) so they can be placed together. */
  group: GroupProps;
  /** A flat 2D part (laser / CNC): exports to DXF/SVG; `thickness` also makes it a 3D part. */
  drawing: DrawingProps;

  /** Translate children. */
  translate: TranslateProps;
  /** Rotate children (degrees, X then Y then Z; or `axis` + `angle`). */
  rotate: RotateProps;
  /** Scale children (uniform or per axis). */
  scale: ScaleProps;
  /** Mirror children across a plane (with `keep`, a symmetric pair). */
  mirror: MirrorProps;

  /** A box; centred in XY, base on z = 0. */
  box: BoxProps;
  /** A cylinder about +Z; base on z = 0. */
  cylinder: CylinderProps;
  /** A cone / frustum about +Z; base on z = 0. */
  cone: ConeProps;
  /** A sphere centred on the origin. */
  sphere: SphereProps;
  /** A torus about +Z centred on the origin. */
  torus: TorusProps;
  /** An imported STEP solid: `<step data={text} />`. */
  step: StepProps;

  /** Union of the children. */
  union: UnionProps;
  /** First child minus the rest. */
  difference: DifferenceProps;
  /** First child minus the rest (alias of `<difference>`). */
  subtract: DifferenceProps;
  /** Common volume of the children. */
  intersection: IntersectionProps;
  /** Common volume of the children (alias of `<intersection>`). */
  intersect: IntersectionProps;

  /** 2D: rectangle (centred). */
  rect: RectProps;
  /** 2D: rectangle with rounded corners (centred). */
  roundedRect: RoundedRectProps;
  /** 2D: circle. */
  circle: CircleProps;
  /** 2D: ellipse. */
  ellipse: EllipseProps;
  /** 2D: polygon through points. */
  polygon: PolygonProps;
  /** 2D: regular polygon. */
  regularPolygon: RegularPolygonProps;
  /** 2D: stadium slot along X. */
  slot: SlotProps;
  /** 2D: SVG path data. */
  path: PathProps;
  /** 2D: star. */
  star: StarProps;
  /** 2D: text outlines (emboss / engrave). */
  text: TextProps;
  /** 2D: groups shapes to place them together. */
  sketch: SketchProps;
  /** 2D: offsets its shapes outward (+) or inward (−). */
  offset: OffsetProps;
  /** 2D: one loft section at height `z`. */
  section: SectionProps;

  /** Extrude 2D shapes (nested loops become holes). */
  extrude: ExtrudeProps;
  /** Revolve a 2D profile (x = radius, y = height) about Z. */
  revolve: RevolveProps;
  /** Loft through 2D sections along Z. */
  loft: LoftProps;
  /** Sweep a 2D profile along a 3D path. */
  sweep: SweepProps;

  /** Copies along a line. */
  linearPattern: LinearPatternProps;
  /** Copies on an XY grid. */
  gridPattern: GridPatternProps;
  /** Copies around an axis. */
  polarPattern: PolarPatternProps;

  /** Round edges. */
  fillet: FilletProps;
  /** Bevel edges. */
  chamfer: ChamferProps;
  /** Hollow out. */
  shell: ShellProps;
  /** Mould draft on faces. */
  draft: DraftProps;
  /** Move faces along their normals (push/pull). */
  pushPull: PushPullProps;
  /** Move faces along their normals (alias of `<pushPull>`; the IR name). */
  offsetFaces: PushPullProps;
  /** Cut with a plane, keep one side. */
  split: SplitProps;
}

export type IntrinsicTag = keyof IntrinsicElements;
