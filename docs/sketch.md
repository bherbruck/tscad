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
