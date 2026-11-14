# Constraint sketches

Draw rough 2D geometry, say how it relates (horizontal, tangent, 40 mm long...), and let the
solver place it exactly — the Fusion / Onshape / SolveSpace workflow, as JSX. Dimensions are
ordinary expressions, so they bind straight to params.

The same sketch in the two reference styles. They mix freely, even in one sketch.

**String ids:**

```tsx
<extrude height={p.thickness}>
  <sketch>
    <point id="o" x={0} y={0} fixed />
    <line id="base"  from="o" to="a" horizontal length={p.width} />
    <line id="right" from="a" to="b" vertical length={p.height} />
    <arc  id="top"   from="b" to="c" tangent radius={p.width / 2} />   {/* tangent to `right` */}
    <line id="left"  from="c" to="o" tangent />                         {/* tangent to `top` */}
    <circle id="hole" center="h" diameter={p.hole} />
    <dimension a="h" b="base" distance={p.height * 0.6} />
    <dimension a="o" b="h" dx={p.width / 2} />
  </sketch>
</extrude>
```

**Typed handles** (React-style refs; a wrong kind such as `tangent={s.o}` is a type error):

```tsx
const s = sketchRefs<{
  o: "point"; a: "point"; b: "point"; c: "point"; h: "point"
  base: "line"; right: "line"; top: "arc"; hole: "circle"
}>()

<extrude height={p.thickness}>
  <sketch>
    <point ref={s.o} x={0} y={0} fixed />
    <line ref={s.base}  from={s.o} to={s.a} horizontal length={p.width} />
    <line ref={s.right} from={s.a} to={s.b} vertical length={p.height} />
    <arc  ref={s.top}   from={s.b} to={s.c} tangent={s.right} radius={p.width / 2} />
    <line from={s.top.end} to={s.o} tangent={s.top} />
    <circle ref={s.hole} center={s.h} diameter={p.hole} />
    <dimension a={s.h} b={s.base} distance={p.height * 0.6} />
    <dimension a={s.o} b={s.h} dx={p.width / 2} />
  </sketch>
</extrude>
```

A `<sketch>` becomes a constraint sketch as soon as it holds `<point>`, `<line>`, `<arc>`,
`<spline>`, a constraint element, or a `<circle>` with `center`/`tangent`/`equal`/`concentric`.
Its closed loops of non-`construction` curves become the profile: they go through the same path
as `<rect>`/`<path>` shapes, so nested loops are holes, and it works in `<extrude>`, `<revolve>`,
`<loft>` (one sketch per `<section>`) and `<sweep>`. Arcs stay exact IR arcs. Plain shapes
(`<rect>`, `<path>`...) may sit in the same sketch; they are used as drawn. Sketch-level
`x`/`y`/`rotate`/`mirror` place the whole solved sketch.

Units: mm and degrees. Sketch y is up.

## Entities

| Element | Props |
|---|---|
| `<point id x y fixed on>` | `x`/`y` (or `at`) are a **rough guess** unless `fixed` (pinned; default 0,0). `on="curve"` keeps it on a curve. |
| `<line id from to>` | `from`/`to`: a point id (created if new), `"other.start"`/`"other.end"`/`"arc.center"`, or `[x, y]` (a new anonymous point with that guess). |
| `<arc id from to center>` | CCW from `from` to `to` about `center` (`cw` to flip). Without `center`, an implicit `"<id>.center"` is created. |
| `<circle id center r/d>` | `center` id or `[x, y]` (or `x`/`y`); `fixed` pins the centre. |
| `<spline id points degree>` | clamped B-spline over control-point refs (default degree 3); ends on the first/last point. |

Every entity takes `construction` (constrains, isn't part of the profile) and an `id` to be
referenced by constraints. Ids share one namespace per sketch. Point refs like `"slot_l.center"`
use `.start`, `.end`, `.center`, so don't put dots in your own ids.

## Constraints as props

| On | Prop | Meaning |
|---|---|---|
| line | `horizontal`, `vertical` | |
| line | `length={40}` | |
| line | `angle={30}` | direction from → to, degrees CCW from +X |
| line | `parallel`, `perpendicular`, `equal` | another line id (or an array) |
| line, arc, circle | `tangent="id"` / `tangent={[...]}` | line–arc/circle or arc/circle–arc/circle |
| line, arc | `tangent` (`true`) | tangent to the curve meeting this one's `from` (smooth continuation) |
| arc, circle | `radius`/`r`, `diameter`/`d`, `equal`, `concentric` | |
| arc | `angle={90}` | sweep |

## Constraint elements

| Element | Meaning |
|---|---|
| `<dimension a b distance>` | point–point distance; point–line: perpendicular distance; line–line: distance between (hence parallel) lines. An arc/circle stands for its centre. |
| `<dimension a b distance side="left" \| "right">` | for a distance from a line: which side of it (looking from → to) the other thing is on. Default: the side it's drawn on |
| `<dimension a b dx dy>` | **signed** `b.x − a.x` / `b.y − a.y` (use these to pick a side deterministically) |
| `<dimension of radius/diameter/length>` | |
| `<dimension a b angle>` / `<angle a b value>` | angle from line a's ray to line b's ray, CCW. Rays leave the shared vertex when the lines meet, else point from → to. |
| `<distance a b value dx dy>` | same as dimension |
| `<coincident a b>` | two points; or a point and a curve (point on curve) |
| `<horizontal a>` / `<vertical a>` | a line, or with `b` two points |
| `<parallel a b>`, `<perpendicular a b>`, `<collinear a b>` | lines (`of={[...]}` for several) |
| `<equal a b>` / `<equal of={[...]}>` | lengths (lines) or radii (arcs/circles) |
| `<tangent a b>`, `<concentric a b>` | |
| `<symmetric a b about>` | mirror across line `about`; point symmetry about point `about` |
| `<symmetric a b about axis="x" \| "y">` | across the vertical (`"x"`: x mirrored) / horizontal (`"y"`) line through point `about` (default the origin) |
| `<midpoint point of>`, `<onCurve point curve>` | |
| `<fix point x y>` | pin (at `x`/`y`, or where drawn) |

Tangency where curves share an end point is a smooth joint (the radius to the joint is square to
the line; two arcs' centres line up with it). A line merely *touching* a circle without a
`tangent` constraint is a double root: it solves, but the DOF check reports it as free.

## In-sketch patterns (copies stay constrained)

| Element | Copies |
|---|---|
| `<mirrorEntities about="axis" of={["lugEnd", "lugTop"]} />` | mirror images across a line, tied by symmetric constraints. A mirrored point is named `"p'"` and a copy's id gets a `'` (`"lugTop'"`). Points on the axis meet their image, so a mirrored half profile closes. |
| `<circularPattern center="o" count={6} angle? of={["hole"]} />` | turned copies tied by rotation constraints. `angle` is the total (360 by default, evenly spaced). |
| `<linearPattern count={4} dx={20} dy? of={["slot"]} />` | translated copies tied by offset constraints (with `of` it patterns sketch entities; without, it's the solid pattern). |

A pattern copy k of point `"p"` is `"p~k"`, and of entity `"lobe"` is `"lobe~k"`. For a full
turn the names wrap round, so a chain can end on the next copy's start. A three-lobe gasket is
one lobe arc and one fillet:

```tsx
<arc id="L" center="c0" from="a0" to="b0" radius={12} />
<arc id="F" from="b0" to="a0~1" tangent="L" radius={10} cw />
<circularPattern center="g" count={3} of={["L", "F"]} />
<tangent a="F" b="L~1" />
```

Copies are real entities (reference them, dimension them) whose points are driven by the
originals: edit one side and the other follows. A circle copy's radius is tied to the
original's. See `examples/sketch-flange.tsx` for mirrored lugs and a bolt-circle pattern.

## Branch hints

When nothing is drawn, some shapes have mirror-image solutions. Hints pick one. They are not
equations: a solution that violates a hint is retried from other starts, and if none honours
it you get a warning.

- `<arc major>` / `<arc minor>`: the long way round (over 180°) or the short way.
- `<tangent a="line" b="arc" side="left" | "right">`: which side of the line, looking from
  `from` to `to`, the arc's centre is on. `<dimension ... side>` does the same for a distance
  from a line.
- `<sketch prefer="ccw" | "cw">`: which way round closed loops go, in declaration order.

## Two ways to reference: string ids or typed handles

Everywhere an entity is referenced (`from`, `to`, `center`, `tangent`, `parallel`, `equal`,
`a`/`b`, `about`, `of`, `point`, `curve`...) you can pass either a **string id** or a **handle**.
Handles work like React refs: attach one with `ref={...}`, pass the same object elsewhere.

```tsx
import { sketchRefs } from "tscad"

const s = sketchRefs<{ o: "point"; a: "point"; b: "point"; c: "point"; base: "line"; right: "line"; top: "arc" }>()
<sketch>
  <point ref={s.o} fixed />
  <line ref={s.base} from={s.o} to={s.a} horizontal length={40} />
  <line ref={s.right} from={s.base.end} to={s.b} vertical length={20} />
  <arc ref={s.top} from={s.b} to={s.c} tangent={s.right} radius={20} />
  <line from={s.top.end} to={s.o} tangent={s.top} />
</sketch>
```

| Form | Checks |
|---|---|
| `sketchRefs<{ o: "point"; base: "line" }>()` | names **and kinds** checked by TypeScript: `tangent={s.o}` (a point) or `from={s.base}` (a line) don't compile |
| `sketchRefs("o", "a", "base")` | names checked (at runtime, an unknown name throws); kinds open. Use this with `noUncheckedIndexedAccess`, where members of an open-ended bag read as possibly undefined |
| `sketchRefs()` | anything goes; handles are created on first access |
| `sketchRef<"circle">("hole")` | one handle |

- `handle.start`, `.end`, `.center` are the curve's points, like `"base.end"`. A closed chain may
  name points of curves declared later (`from={s.upper.end}` before `<line ref={s.upper}>`).
- Messages show handles by property name: `tangent: handle .lower is used but never attached in this sketch`, at the element's source location.
- Like string ids, a handle used as a point (`from`, `to`, `center`) that is never attached is
  created as a new point. A handle used where a curve is needed and never attached is an
  error at the use. A `<point>` that nothing refers to warns at its declaration (usually a typo
  in the reference). Attaching one handle twice is a `duplicate id` error, and giving both `id`
  and `ref` is an error.
- Handles are unique objects, so sketch **components** can make their own private handles, and
  several copies can sit in one sketch. With string ids, prefix them instead (`${id}_l`). See
  `Slot` in `examples/sketch-link-arm.tsx`, which uses handles throughout (the pulley example
  uses string ids).

## Solver

Own implementation, no dependencies (`src/core/sketch/solver/`): every constraint is a small
residual function evaluated with forward-mode dual numbers (exact Jacobian), solved by
Levenberg–Marquardt in minimum-norm form `dx = −Jᵀ(JJᵀ + λI)⁻¹F` with a trust radius.
Minimum-norm steps keep under-constrained geometry where it was drawn. Convergence: largest
residual < 1e-10 × max(1, sketch size) mm. Deterministic.

**Closed loops without drawn positions.** A loop of lines and arcs with at most one placed point
(a fixed start, or a fixed centre) is laid out as a whole. The layout walks the loop: fixed
line directions (`horizontal`, `vertical`, `angle`) stay fixed, tangent joints carry the
direction through, and the unknown corners and arc sweeps share the turning a counter-clockwise
loop needs (2π in all; concave `cw` arcs take a small share). Unknown line lengths are then sized
so the loop closes (least squares around a typical length), and the points and arc centres are
placed and moved onto the anchor. A fillet arc between two arcs with known centres and radii
starts where its offset circles cross, on the outside. Rounded squares, slots, obrounds,
keyholes, D shapes and six-arc gaskets all solve without drawn positions (see
`tests/sketch.layout.test.tsx`).

**Relax restarts.** If the solve doesn't converge, or converges to an unsound shape (a collapsed
line or arc, or a self-crossing profile), the solver retries from up to 16 deterministic
perturbations of the start, in two sizes. Points the user drew move less in these retries.
It keeps the first sound solution, and only then reports a conflict.

**Initial guess.** Points without `x`/`y` are laid out by walking the curves: a line continues
from its known end along its constraint direction (horizontal/vertical/angle/parallel...), or
turns left (CCW polygon) by default, at its `length` (else a typical size from the dimensions);
tangent curves continue smoothly; arcs with only a centre bulge away from the rest of the
drawing; arcs default to 180° when tangent, else 90°. Unsigned values (`length`, `distance`,
`radius`) have two branches: give a rough `x`/`y`, or use signed `dx`/`dy`/`angle`, when the
default walk picks the wrong one.

**Which solution.** Unsigned values have mirror-image solutions. The solver starts from the
drawn and laid-out guesses and takes minimum-norm steps, so it lands on the solution nearest
the drawing. Point–line and line–line distances and tangencies keep the side they are drawn
on, or the one `side` names.

**Cache.** Solves are cached (LRU, 128) by a canonical key: each solved element's tag, props
and source location. Handles are renumbered, so fresh `sketchRefs()` per render still hit.
A param change that doesn't touch a sketch skips its solve, and cached warnings are replayed.
`clearSketchCache()` (from `src/core/sketch/constrained`) empties the cache.

## Diagnostics

All carry JSX source locations.

- **Under-constrained** (warning; still solved near the drawn positions):
  `sketch.tsx:12:7: <sketch> under-constrained: 2 degrees of freedom remain (free: point "h")`.
  `<sketch strict>` makes it an error, `<sketch allowFree>` silences it. DOF = variables − rank(J).
- **Over-constrained / conflicting** (error, at the later constraint):
  `over-constrained: <dimension a="o" b="a" distance=50> conflicts with length=40 on line "base" (sketch.tsx:9)`.
  Found by locating the first constraint (in source order) that makes the system unsolvable;
  its partners are the constraints left with residuals at the least-squares optimum.
- **Redundant** (warning): `redundant constraint: <horizontal a="o" b="a"> is already implied by horizontal on line "base" (sketch.tsx:9)`.
- **Profile**: `open profile: line "x" ends at point "a" and nothing continues from there`;
  `branching profile: 3 curves meet at point "p"`; a self-crossing profile warns
  (`the profile crosses itself near (5, 5)`), usually an unsigned dimension that flipped.
- Unknown ids get "did you mean" suggestions. Constraint elements outside a `<sketch>` get a
  "belongs in a constraint `<sketch>`" error.
- A declared `<point>` that nothing uses warns.

## Compile-result metadata (for the viewer)

`compile()` / `renderModule()` results carry `sketches: SketchInfo[]`, one per constraint sketch
per IR occurrence (a sketch inside a pattern appears once per copy):

```ts
interface SketchInfo {
  path: string;          // IR path of the node built from the sketch (the extrude/revolve/loft/sweep,
                         // or the difference/union nesting its regions), e.g. "parts/0/0"
  plane: number[];       // 4×4 row-major: sketch (x, y, 0, 1) → model space, incl. enclosing transforms
  loc?: SourceLoc;       // the <sketch> element
  status: "ok" | "under";
  dof: number;
  free: string[];        // e.g. ['point "h"', 'circle "hole" radius']
  residual: number;      // mm
  iterations: number;
  points: { id: string; x: number; y: number; free: boolean }[];
  entities: (
    | { kind: "line"; id?; from: [x, y]; to: [x, y]; fromId: string; toId: string; construction: boolean }
    | { kind: "arc"; id?; center; from; to; radius: number; ccw: boolean; construction: boolean }
    | { kind: "circle"; id?; center; radius: number; construction: boolean }
    | { kind: "spline"; id?; points: [x, y][]; degree: number; construction: boolean }
  )[];
  dimensions: {
    kind: "distance" | "length" | "dx" | "dy" | "radius" | "diameter" | "angle" | "sweep";
    value: number;       // mm, or degrees for angle/sweep
    text: string;        // "40", "R5", "⌀10", "30°"
    points: [x, y][];    // distance/length/dx/dy: [a, b] (point–line: [point, foot]);
                         // radius/diameter: [center, pointOnCurve]; angle: [vertex, onA, onB];
                         // sweep: [center, from, to]
    loc?: SourceLoc;     // the element that set it (for click-to-source)
  }[];
}
```

All coordinates are sketch coordinates; map with `plane`. Coordinates are snapped to 1e-6 mm
when within 1e-9 of it, so solved values print cleanly. Types are exported from `tscad`.

In-sketch patterns appear in the metadata too:

```ts
// every pattern copy in entities[] carries
copyOf?: { index: number /* original's index in entities */; pattern: number /* index in patterns */; copy: number /* 1, 2... */ }
// and SolvedSketch has
patterns: {
  kind: "mirror" | "circular" | "linear";
  of: number[];          // indices of the originals in entities
  copies: number[][];    // per copy, the indices of its entities (in `of` order)
  center?: [x, y]; angle?: number;   // circular: centre, degrees between copies
  axis?: [[x, y], [x, y]];           // mirror: two points on the mirror line
  step?: [dx, dy];                   // linear
  loc?: SourceLoc;
}[]
```

## `sketchPath()` — unconstrained fluent paths

For quick outlines that need no solving, `sketchPath()` builds SVG path data with turtle moves
and tangent arcs:

```tsx
import { sketchPath } from "tscad"
<path d={sketchPath(0, 0).hLine(20).vLine(30).tangentArc(10, 180).close().d} />
```

`moveTo`, `lineTo`, `line(dx, dy)`, `hLine`, `vLine`, `hLineTo`, `vLineTo`, `polarLine(len, deg)`,
`forward(len, turnDeg)`, `arcTo(x, y, r, { cw, large })`, `tangentArc(r, sweepDeg)` (positive
turns left), `tangentArcTo(x, y)`, `close()`; `.d` (or `String(path)`) is the path data.

## Examples

- `examples/sketch-link-arm.tsx` — two bosses joined by tangent lines, bores and a slot component, written with typed handles.
- `examples/sketch-pulley.tsx` — V-belt pulley half-section mirrored with `symmetric`, revolved.

## `<hull>`: exact convex hulls

`<hull>` works anywhere 2D shapes do: in `<extrude>`, `<revolve>`, `<loft>` sections,
`<drawing>`, `<offset>` and constraint sketches' plain children. It takes the convex hull of
its children:

- Polygons stay polygons.
- Circles and arcs give exact tangent segments and true arcs: two circles make a slot, three a
  rounded triangle, and unequal circles a cam profile.
- NURBS and text are flattened.

```tsx
<extrude height={6}>
  <hull><circle r={12} /><circle r={5} x={17} /></hull>   {/* a plate cam */}
  <circle d={6} />                                          {/* bore */}
</extrude>
```

Method (`src/core/sketch/hull.ts`): sweep the support function h(θ) once round. The children
reduce to point sites and arc sites, where an arc only supports directions within its range and
its end points are separate point sites. Each change of active site happens at an exact angle,
found in closed form where the two supports are equal. An active arc site contributes an arc,
and each change contributes the common tangent segment. A flat (zero-area) input is an error.

## Sketch-driven sweeps: `<sweepPath>`

Draw a sweep's path in 2D, on a plane, as a constraint sketch or SVG path data. The
`<sweep>`'s other children are the profile, which is placed square to the path's start
automatically:

```tsx
<sweep>
  <sweepPath plane="YZ">                       {/* sketch x → Y, sketch y → Z */}
    <sketch>
      <point id="o" x={0} y={20} fixed />
      <line id="out" from="o" to="knee" horizontal length={35} />
      <arc id="curl" from="knee" to="tip" tangent="out" radius={14} angle={75} />
    </sketch>
  </sweepPath>
  <circle d={8} />
</sweep>
```

- `plane` is `"XY"` (the default), `"XZ"` or `"YZ"`, as for `<extrude>`. `offset` shifts the
  plane along its normal, and `x`/`y`/`rotate`/`mirror` place the path in the plane.
- Children are a constraint `<sketch>` and/or `<path d="M ...">` pieces. A constraint sketch
  used as a path is one chain of non-construction curves: open, or closed (a single
  `<circle>` or loop makes a ring). Pieces are joined end to end, and a piece drawn backwards
  is flipped. A gap is an error.
- Lines and arcs stay exact IR lines and arcs. The kernel sweeps exactly piece by piece along
  tangent-continuous lines and arcs, so **sharp corners warn**: join lines with tangent arcs.
- The path sketch shows up in `CompileResult.sketches` with its own plane, so the viewer can
  overlay it.

Checked against closed forms: a circle swept round a closed circle (Pappus), line + tangent
arc + line paths from SVG data and from a constraint sketch. See
`examples/sketch-coat-hook.tsx`.

## Lofts through constraint sketches

`<loft>` sections can be constraint sketches: give each `<sketch z={...}>`, or wrap it in
`<section z={...}>`. Each section's metadata carries its own plane. Sections with the same
structure (the same lines and arcs in the same order) loft cleanly. See
`examples/sketch-vase.tsx`: three rounded squares (four lines and four tangent arcs, sized by
params) at the foot, belly and neck, smoothly lofted and shelled. No point positions are
drawn at all: the loop layout below finds the shape.

## Importing 2D drawings: `<dxf>` and `<svg>`

Both are 2D shapes, so they work anywhere a `<rect>` does: in extrude, revolve, loft sections,
drawings, 2D booleans, offset and hull. Read the file as text with Bun's import attribute:

```tsx
// @ts-ignore — a text import
import logo from "./logo.svg" with { type: "text" }
// @ts-ignore
import plate from "./plate.dxf" with { type: "text" }

<extrude height={1}><svg data={logo} select="#mark" scale={0.5} center /></extrude>
<extrude height={3}><dxf data={plate} layer="CUT" units="in" /></extrude>
```

| | `<dxf>` | `<svg>` |
|---|---|---|
| geometry | LINE, ARC, CIRCLE, LWPOLYLINE / POLYLINE (bulges → exact arcs), SPLINE (control points, rational too), ELLIPSE (exact rational NURBS), INSERT of BLOCKs (nested; base point, scale, rotation, arrays), OCS-flipped arcs | `<path>` (every command; circular arcs exact, elliptical arcs exact rational NURBS), `<rect rx ry>`, `<circle>`, `<ellipse>`, `<polygon>`, `<polyline>` (closed), `<g transform>` (matrix / translate / scale / rotate / skew; non-uniform scale turns arcs into exact NURBS) |
| units | `$INSUNITS` → mm (unitless = mm); `units="mm" \| "cm" \| "m" \| "in" \| "ft"` overrides | the viewBox and `width` / `height` (`mm`, `cm`, `in`, `pt`, `px`); without them 1 user unit = 1 px = 0.2646 mm. y is flipped to point up (`flipY={false}` keeps it) |
| loops | closed entities as they are; loose ones chained end to end (ends within `tolerance`, default 1e-5 × size, at least 0.001 mm). An open chain warns with its entity handles and is left out | each element's `fill-rule` decides its holes (nonzero by default); separate elements that overlap are unioned, as SVG paints them. Fill and stroke colours are ignored, so stroke-only laser files work |
| pick | `layer="CUT"` or a list | `select="#id"` or `".class"` (that element and its children) |
| both | `scale`, `center` (move the bounding-box centre to the origin), placement `x` `y` `rotate` `mirror` | same |

A near-full arc closed by a tiny line (a common way SVG editors draw circles) becomes a full
circle, and slivers shorter than 1e-4 × the shape's size are dropped. Text, `<line>`,
`<use>` and images are skipped with a warning (convert text to paths). Our own `toDXF` /
`toSVG` output re-imports to the same loops (tested). See `examples/engraved-logo.tsx`.

## Drag-to-edit (for editors)

`dragSolve` re-solves a sketch with one point dragged. The point is cheap to place and
expensive to move: a weighted minimum-norm solve, walked to the target in steps. Everything
else moves as little as it can. The result says what to change in the source to make that the
new design. `applyChange` makes the minimal text edit.

```ts
import { dragSolve, applyChanges, renderModule } from "tscad"

const r = renderModule(mod, values)                      // the sketch's loc: r.sketches[i].loc
const d = dragSolve(mod, r.values, { sketch: r.sketches[0].loc!, point: "h", target: [25, 12], changeDimensions: false })
d.points / d.entities                                     // the dragged shape, for the overlay
d.reached                                                 // got to the target?
d.blockedBy                                               // [{ label: 'length=20 on line "side"', loc, dimension: { kind, value, prop } }]
d.changes                                                 // what to edit (below)
const { source, applied, refused } = applyChanges(text, d.changes)
```

`changes`:

- `{ kind: "prop", loc, tag, prop, value, reason: "point" | "dimension", param? }`:
  - **`reason: "point"`**: a moved free `<point>`'s `x`/`y` guess (inserted when absent, made
    relative to `at`).
  - **`reason: "dimension"`** (with `changeDimensions: true`): the dimensions that blocked the
    drag are released, and those whose value changed get their new value (`length`, `radius`,
    `diameter`, `distance`, `dx`, `angle`... with the prop that set them).
  - **`param`**: when the prop is an expression that varies linearly with exactly one numeric
    param (found by perturbing each param and re-rendering), `param: { name, value }` is the
    param value that gives `value`.
- `{ kind: "addPoint", sketch, id, x, y }`: a free implicit point (named in a line's `from`/`to`,
  no `<point>`) gets a `<point id x y />`, inserted right after `<sketch>`.

`applyChange` replaces a number literal or inserts the prop. It refuses expressions
(`length={p.width}`) with `{ ok: false, reason: "... driven by param width", param }`, so the UI
can move the param slider instead. `editProp` / `insertChild` are the plain text functions
(`src/core/sketch/edit.ts`). They find the element by its `SourceLoc` (the `<`), with no
TypeScript parser.

`blockedBy` lists the constraints left with residuals when the target is enforced in least
squares, those on the dragged point first. A point on a line slides along it, and reports the
`<onCurve>` as what blocks the rest of the motion.

## Sketch on a face: `<pocket>`, `<boss>`, `<cutThrough>`, `<onFace>`

Draw on a face of the solid built so far. The kernel finds the face, builds a frame there and
places the feature, so no coordinates are computed for where the face ended up.

```tsx
<pocket face=">Z" depth={7}>                 {/* solid children: the base */}
  <boss face=">Z" height={8}>
    <box size={[60, 50, 10]} />
    <circle d={32} />                         {/* 2D children: the profile, on the face */}
  </boss>
  <circle d={22} />
</pocket>
```

- **The face frame:** origin at the centre of the face's bounding box, +Z out of the material,
  +X along model X projected onto the face (Y when the face is square to X), +Y = Z × X. The
  face must be planar.
- **`face`** is a face selector (`">Z"`, `"<Y"`, `faces.within(...)`...), and **`index`** picks
  among several matches (kernel order).
- **`<pocket depth>`** cuts the profile into the face; **`<boss height>`** raises it;
  **`<cutThrough depth?>`** cuts through (default 2000 mm). `draft` tapers. `x`/`y`/`rotate` move the
  profile within the face. Profiles can be shapes, `<sketch>`es, constraint sketches, `<svg>`...
- **`<onFace face index op>`** is the general form: the **first child is the base**, and the other
  children are 3D tools modelled in the face frame (+Z out of the face), combined by `op`:
  `"union"` (default), `"cut"`, `"intersect"`, or `"none"` (just the placed tools).
- Features chain: a feature's base can be another feature's result, so the face is found on
  the solid as it is at that step. To pick a face that is no longer the topmost (say the base's
  top once a boss stands on it), use `faces.within(min, max)` around it.

**Metadata:** sketches drawn on a face carry `onFace: "<IR path of the onFace node>"` in
`CompileResult.sketches`. Their `plane` is relative to the face frame, which only the kernel
knows (it is built during evaluation), so an overlay can't place them in model space from the
compile result alone. The source map covers the base at `<path>/base`.

See `examples/sketch-on-face.tsx`: a bearing block with a boss, a bearing pocket, a shaft bore,
counterbored holes from a patterned constraint sketch, and a slot in the front face.
