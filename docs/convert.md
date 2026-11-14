# Converting OpenSCAD models

`convertScad(source)` turns an OpenSCAD `.scad` file into a tscad model (`.tsx`). Customizer
variables become params, modules become components, and the geometry matches OpenSCAD's.

```ts
import { convertScad } from "tscad/src/convert"   // CLI: tscad convert in.scad -o out.tsx

const { tsx, warnings } = convertScad(await Bun.file("box.scad").text(), { name: "Box" })
for (const w of warnings) console.warn(`box.scad:${w.line}: ${w.message}`)
```

`warnings` lists everything that couldn't be converted exactly, by `.scad` line. A source that
doesn't parse throws `ScadSyntaxError` with `line` and `col`.

## What you get

```scad
/* [Box] */
// Outer width
width = 60; // [20:1:200]
part = "both"; // [base, lid, both]
module shell(w, d, h, t) {
  difference() { cube([w, d, h]); translate([t, t, t]) cube([w - 2*t, d - 2*t, h]); }
}
if (part != "lid") shell(width, 40, 25, 2);
```

becomes

```tsx
export const params = defineParams({
  width: { type: "int", default: 60, min: 20, max: 200, step: 1, description: "Outer width", group: "Box" },
  part: { type: "choice", default: "both", options: ["base", "lid", "both"], group: "Box" },
})

/** OpenSCAD module shell(w, d, h, t) */
function Shell({ w, d, h, t }: { w: number; d: number; h: number; t: number }) {
  return (
    <difference>
      <box size={[w, d, h]} center={false} />
      <translate by={[t, t, t]}><box size={[w - 2 * t, d - 2 * t, h]} center={false} /></translate>
    </difference>
  )
}

export default function Model(p: ParamValues<typeof params>) {
  const { width, part } = p
  return <>{part !== "lid" ? <Shell w={width} d={40} h={25} t={2} /> : null}</>
}
```

The output is self-contained: any OpenSCAD semantics it relies on (vector arithmetic, degree
trig, ranges, truthiness) are small helper functions copied to the end of the file.

## Customizer → `defineParams`

Variables are treated as params when they are assigned a literal at the top level before the
first `module`/`function` definition, and are not in the `/* [Hidden] */` section. That is the
Customizer's own rule.

| `.scad` | param |
|---|---|
| `x = 5; // [0:10]` | number (int when all values are whole) with min/max |
| `x = 5; // [0:0.5:10]` | min / step / max |
| `x = 5; // [10]` | max (min 0) |
| `x = "a"; // [a, b, c]` | choice |
| `x = 2; // [1:Low, 2:Mid, 3:High]` | choice with `optionLabels` |
| `x = true;` | boolean |
| `s = "hi"; // 8` | text, `maxLength: 8` |
| `/* [Section] */` | `group` of the variables after it |
| comment line above (else a plain trailing comment) | `description` |

Other top-level variables become `const`s inside the model, in order. OpenSCAD's "last
assignment wins" is kept, with a warning.

## Language

Fully converted:
- Numbers, strings, booleans, `undef`, vectors, ranges, `.x/.y/.z`, indexing, operators
  (`^` is `**`), the ternary, `let`, function literals.
- List comprehensions: `for` (including C-style `for (i = 0; i < n; i = i + 1)`), `if`/`else`,
  `let`, `each`.
- `function`s (recursion included) become TS functions. `module`s become components with
  default props, and `children()` / `children(i)` / `$children` work.
- Modules and functions are hoisted to file level unless they read top-level variables. In
  that case they're nested inside the model so params stay in scope. Nested definitions are
  moved to file level (warning).
- Untyped parameters get their types from the call sites: a parameter that only ever receives
  numbers is `number`, and its arithmetic stays plain `a - 2 * t`. Vectors (or unknowns) go
  through helpers: `$add`, `$mul` (scalar × vector, dot and matrix products)...
- Built-ins: degree trig, `abs sqrt floor ceil round exp ln log pow min max sign norm cross len
  concat str chr ord lookup is_*`.
- `for`, `intersection_for`, `if`/`else`, `let`, and the `#`/`!`/`*`/`%` modifiers (`*` and
  `%` drop the object). `echo` and `assert` are dropped.
- `include <…>` / `use <…>` are noted as warnings: convert that file too.

## Geometry

OpenSCAD's placement conventions are kept, so shapes land exactly where they did:

| `.scad` | tscad |
|---|---|
| `cube(s, center)` | `<box size center={false}>` (corner at the origin unless centred) |
| `sphere(r \| d)` | `<sphere>` |
| `cylinder(h, r \| d, r1/r2/d1/d2, center)` | `<cylinder>` / `<cone>` (base on z = 0, `center` centres z) |
| `cylinder(..., $fn = 6)` (any literal `$fn` < 16) | a faceted prism: `<extrude><regularPolygon sides>` (hex nut traps!), or a ruled loft for a cone |
| `$fn` / `$fa` / `$fs` otherwise | ignored: tscad circles are exact |
| `union` / `difference` / `intersection` | same; each operand statement is one solid (loops become a `<union>`) |
| `translate` / `rotate(a)` / `rotate(a, v)` / `scale` / `mirror` | `<translate by>` / `<rotate by \| z>` / `<rotate axis angle>` / `<scale by>` / `<mirror axis>` |
| `linear_extrude(height, center)` | `<extrude>` |
| `rotate_extrude(angle)` | `<revolve>` |
| `square(s, center)` / `circle` / `polygon(points, paths)` / `text` / `offset(r \| delta)` | `<rect center={false}>` / `<circle>` / `<polygon>` (one per path, so nested paths are holes) / `<text>` / `<offset round>` |
| `scale(v) circle(r)` | `<ellipse rx ry>` |
| 2D `hull()` | `<hull>`: exact (tangent lines and true arcs) |
| 2D `minkowski() { shape; circle(r); }` | `<offset distance={r}>` (rounded): exact |
| `minkowski() { cube(s); sphere(r); }` | `<fillet radius={r}><box>` grown by r on every side: exact (a box ⊕ a ball *is* the grown box with every edge filleted r) |
| `minkowski() { cube(s); cylinder(r, h); }` | `<extrude height={z + h}><roundedRect>` grown by r: exact |
| `multmatrix(m)` | `<transform matrix={m}>` (4×4 or 3×4, row-major, column-vector) |
| `resize([x, y, z])` (literal sizes) on one cube/square | the primitive with the new size (0 keeps a dimension) |
| `resize([x, y, z])` on one sphere/circle/cylinder of literal size | `<scale by>` of the computed factors |
| 3D `hull()` of straight prisms on one base (cylinders and cubes of one height, moved by `translate([x, y, 0])`, `rotate([0, 0, a])` or `for` loops) | `<extrude height><hull>` of their footprints: exact, e.g. rounded plates from four corner cylinders |

**2D booleans.** tscad has no 2D boolean kernel. Instead, each 2D leaf under an extrusion is
extruded on its own, and the 2D `difference` / `intersection` / `union` become 3D booleans of
the extruded leaves. This is exact, because linear and rotational extrusion both distribute
over the booleans. Under `linear_extrude`, 2D transforms become 3D transforms of the extruded
leaves, which is also exact since planar motions commute with the extrusion. Under
`rotate_extrude`, they become `<sketch at rotate mirror>` placements. A module that draws 2D
gets a `$leaf` prop, so the caller decides how its shapes become solids (extruded or
revolved). A 2D object where a solid is expected (top level) is extruded 1 mm, with a warning.

**Not converted (warnings):** other 3D `hull`s and `minkowski`s (children unioned),
`polyhedron`, `import`, `surface`, `projection`, other `resize`s (`auto`, expressions), `linear_extrude` `twist` / `scale`,
`offset(chamfer)`, 2D booleans inside `offset()` (even-odd approximation), `color` (set it on
the `<part>`), text fonts (metrics differ, so check the size), `search`, `rands` (works but
random).

## Tests and examples

`tests/convert.test.ts` covers the parser and codegen. It also checks geometric equivalence:
converted snippets and three classic parametric models (`tests/fixtures/scad/`: a box with
lid, a knurled knob with a D-shaft bore, a hex-key holder, a key tag hulled from four corner
cylinders, a plate cam from a 2D hull), plus a corpus of realistic models
(`tests/fixtures/scad/corpus/`: an enclosure with screw posts, a spool holder, a cable comb,
a gridfinity-style bin) are evaluated by the kernel, and
their volumes are compared with closed forms. The converted models are in `examples/converted/`
next to their `.scad` sources. A test keeps them in sync with the converter and checks that each
evaluates in under 10 s.
