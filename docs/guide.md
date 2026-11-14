# The tscad guide

This guide builds a real part from scratch — a wall-mounted shelf bracket — and introduces one
idea per step. By the end you will have used primitives, booleans, sketches, features,
selectors, patterns, components, parameters and export. It assumes you know a little TypeScript
and have seen JSX before; you do not need to know React.

All lengths are millimetres and all angles are degrees. Z is up.

- [1. Set up](#1-set-up)
- [2. A first part](#2-a-first-part)
- [3. Placement](#3-placement)
- [4. Booleans](#4-booleans)
- [5. Sketches and extrusion](#5-sketches-and-extrusion)
- [6. Fillets, chamfers and selectors](#6-fillets-chamfers-and-selectors)
- [7. Patterns](#7-patterns)
- [8. Components](#8-components)
- [9. Parameters](#9-parameters)
- [10. Revolve, shell, loft and sweep](#10-revolve-shell-loft-and-sweep)
- [11. Assemblies](#11-assemblies)
- [12. Export](#12-export)
- [13. Using tscad from code](#13-using-tscad-from-code)
- [14. When something fails](#14-when-something-fails)

## 1. Set up

```sh
bunx tscad init shelf
cd shelf
bunx tscad dev --open
```

`tscad init` writes `index.tsx`, `package.json` and `tsconfig.json`; `tscad dev` serves a viewer
for `index.tsx` (or the file you pass) at http://localhost:3333. Every time you save the file, the model rebuilds.
To use tscad in an existing bun project instead, `bun add tscad` and add this to `tsconfig.json`:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "tscad" } }
```

## 2. A first part

A model file default-exports a function component that returns a `<part>`:

```tsx
export default function Shelf() {
  return (
    <part name="bracket" color="#4f7cac">
      <box size={[80, 40, 5]} />
    </part>
  )
}
```

`<box>` is **centred in X and Y with its base on z = 0** — ready to print. `center={false}` puts
its lower corner on the origin instead, `center` centres it in Z too, and `center={[true, false,
false]}` picks per axis. `<cylinder r h>` (or `d`) and `<cone r1 r2 h>` stand on the XY plane
about the Z axis; `<sphere r>` and `<torus R r>` are centred on the origin. A file whose root
isn't a `<part>` gets wrapped in one named `part`.

## 3. Placement

Every solid takes placement props: `x y z` (or `at={[x, y, z]}`) move it, `rotate={[rx, ry, rz]}`
rotates it about the X, then Y, then Z axes, `rotateX`/`rotateY`/`rotateZ` rotate about one axis,
`scale` scales uniformly and `mirror="x"` reflects. They apply in the order mirror, scale, rotate,
translate, all about the origin. For an explicit transform of a whole group there are also
`<translate>`, `<rotate axis angle origin>`, `<scale>` and `<mirror>`.

```tsx
<cylinder r={3} h={20} x={10} y={20} z={-5} />
<box size={[10, 10, 40]} rotate={[0, 30, 0]} />
```

## 4. Booleans

`<union>` joins its children, `<intersection>` keeps what they share, and `<difference>`
subtracts every later child from the first one. Give cutting tools some extra length so they
pass cleanly through the faces they cut — coplanar faces are legal, but clear cuts are easier to
read.

```tsx
<part name="bracket">
  <difference>
    <union>
      <box size={[80, 40, 5]} center={false} />   {/* shelf arm */}
      <box size={[80, 5, 60]} center={false} />   {/* wall plate */}
    </union>
    <cylinder r={2.5} h={20} x={20} y={20} z={-5} />
    <cylinder r={2.5} h={20} x={60} y={20} z={-5} />
  </difference>
</part>
```

## 5. Sketches and extrusion

Sketches are 2D shapes drawn in the XY plane; `<extrude height>` turns them into a solid along +Z:

```tsx
<extrude height={5}>
  <polygon points={[[0, 0], [40, 0], [0, 40]]} />
</extrude>
```

The 2D shapes are `<rect w h>`, `<roundedRect w h r>`, `<circle r>`, `<ellipse rx ry>`,
`<polygon points>`, `<regularPolygon sides r>` (or `flats` for a hex across flats),
`<slot length width>`, `<star points r1 r2>` and `<path d>`. Shapes are centred on their position
and take `x y rotate mirror`; `<sketch>` groups shapes to move them together. A loop that lies
inside another loop becomes a hole:

```tsx
<extrude height={3}>
  <roundedRect w={40} h={20} r={4} />
  <circle r={4} x={-10} />
  <slot length={12} width={4} x={8} />
</extrude>
```

`draft={5}` tapers the walls inward by 5° as they rise.

`<path d="…">` takes SVG path data — `M L H V C S Q T A Z`, absolute and relative. Béziers become
exact NURBS curves and circular arcs exact arcs, so a curved sketch stays curved in STEP. Unlike
SVG, y points up.

To sketch on another plane, use `plane`: `"XZ"` maps sketch x → X and y → Z and extrudes along
−Y; `"YZ"` maps sketch x → Y and y → Z and extrudes along +X. `center` extrudes symmetrically.
The gusset of our bracket is a triangle in the YZ plane, extruded along X:

```tsx
<extrude height={5} plane="YZ" x={37.5}>
  <polygon points={[[0, 0], [35, 0], [0, 35]]} />
</extrude>
```

## 6. Fillets, chamfers and selectors

`<fillet radius edges>` rounds edges of its child, `<chamfer distance edges>` bevels them. The
`edges` prop is a **selector**:

```tsx
import { edges } from "tscad"

<fillet radius={4} edges={edges.vertical()}>
  <box size={[80, 40, 5]} />
</fillet>
```

Builders chain, and each step narrows the selection:

| Builder | String | Meaning |
|---|---|---|
| `edges.all()` | `"*"` | everything |
| `edges.top()` / `edges.max("z")` | `">Z"` | lying wholly at the top of the body |
| `edges.bottom()` / `edges.min("z")` | `"<Z"` | at the bottom |
| `edges.vertical()` / `edges.parallel("z")` | `"\|Z"` | straight edges along Z |
| `edges.circles()` / `edges.perpendicular("z")` | `"#Z"` | circles about Z |
| `edges.radius(3)` | | circles of radius 3 |
| `edges.within([x0,y0,z0], [x1,y1,z1])` | | inside a box |
| `a.and(b)`, `a.or(b)`, `a.not()` | `"and" "or" "not"` | combine |

So `edges.top().circles()` is "circular edges at the top", and `">Z or |Z"` is "the top edges and
the vertical ones". The string form follows CadQuery.

**Finding the right selector**: click an edge in the viewer. The pick panel lists the selectors
that name it and how many edges each one matches; copy the most specific one.

Selectors act on the solid *as it is at that point of the tree*: fillet before you drill holes
when you only want the outer corners rounded, after when you want the holes rounded too.

Broad selectors skip edges that can't be rounded (seams, and edges between tangent faces), so
`edges.top()` on an extruded `roundedRect` rounds the whole top outline in one go.

## 7. Patterns

Patterns repeat their children:

```tsx
<linearPattern count={4} step={[15, 0, 0]}>       {/* 4 copies, 15 mm apart along X */}
  <cylinder r={2.5} h={20} x={10} y={20} z={-5} />
</linearPattern>

<gridPattern nx={3} ny={2} dx={20} dy={15}>         {/* a 3 × 2 grid, centred on the child */}
  <cylinder r={2.5} h={20} z={-5} />
</gridPattern>

<polarPattern count={6} radius={25}>                {/* 6 copies on a 25 mm bolt circle */}
  <cylinder r={3} h={20} />
</polarPattern>

<mirror axis="x" keep>                              {/* the child and its mirror image */}
  <box size={[10, 5, 5]} x={20} />
</mirror>
```

`linearPattern` takes `step={[dx, dy, dz]}` or `dx`/`dy`/`dz`; `gridPattern` is centred unless
`center={false}`; `polarPattern` takes `angle` (total sweep, default 360), `axis` and
`startAngle`.

Because tscad is TypeScript, `Array.from` and `.map()` are patterns too — use them whenever the
copies differ:

```tsx
{[20, 50, 80].map((x) => <cylinder r={x / 20} h={20} x={x} z={-5} />)}
```

## 8. Components

A component is a function that takes props and returns JSX. Here is a countersunk screw hole
that works anywhere — subtract it from any plate:

```tsx
function CountersunkHole({ d = 3.2, head = 6.5, depth = 20, x = 0, y = 0, z = 0 }) {
  const sink = (head - d) / 2
  return (
    <union x={x} y={y} z={z}>
      <cylinder r={d / 2} h={depth} z={-depth} />
      <cone r1={d / 2} r2={head / 2} h={sink} z={-sink} />
    </union>
  )
}

<difference>
  <box size={[80, 5, 60]} center={false} />
  <rotate x={90}>                     {/* point the hole along +Y, into the plate */}
    <CountersunkHole x={20} y={45} />
  </rotate>
</difference>
```

Components compose like React: they can hold other components, take `children`, use defaults and
destructuring, and share values through `createContext` / `useContext`. They run once, when the
model compiles — there is no state, no effects and no re-rendering. A component is just a way to
name and reuse geometry. See [`examples/component-library.tsx`](../examples/component-library.tsx).

## 9. Parameters

`defineParams` declares the knobs of a model. Export it as `params`, and type the component's
props with `ParamValues`:

```tsx
import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  length:    { type: "number", default: 80, min: 30, max: 200, step: 1, unit: "mm", label: "Arm length" },
  holes:     { type: "int", default: 2, min: 1, max: 6 },
  gusset:    { type: "boolean", default: true },
  finish:    { type: "choice", default: "blue", options: ["blue", "black", "raw"] },
})

export default function Shelf({ length, holes, gusset, finish }: ParamValues<typeof params>) {
  // length: number, holes: number, gusset: boolean, finish: "blue" | "black" | "raw"
}
```

There are also `color` and `text` params. In the viewer every parameter becomes a slider,
toggle, dropdown or input. Changing one re-runs only your function; the kernel reuses every
subtree that didn't change, so only the affected branch is rebuilt. On the command line, set
values with `-p`:

```sh
tscad build shelf.tsx -p length=120 -p holes=3 -o shelf.step
```

## 10. Revolve, shell, loft and sweep

`<revolve>` spins a sketch around the Z axis — sketch the half-profile with x as the radius and
y as the height (`angle` defaults to 360):

```tsx
<revolve>
  <path d="M 0 0 L 30 0 C 50 30 10 60 20 100 L 0 100 Z" />
</revolve>
```

`<shell thickness open>` hollows a solid to a wall `thickness` (inward; `outward` keeps the
inside size) and removes the `open` faces:

```tsx
import { faces } from "tscad"

<shell thickness={2} open={faces.top()}>
  <box size={[60, 40, 30]} />
</shell>
```

`<loft>` skins through sketches stacked along Z — give each shape a `z`:

```tsx
<loft>
  <rect w={20} h={20} z={0} />
  <circle r={8} z={20} />
</loft>
```

`<sweep path>` drags a profile along a 3D path built with `polyline3`, `arc3`, `bezier3` or
`helix`. (Sweeps along a helix don't produce closed solids yet, so threads are cosmetic for now.)

## 11. Assemblies

A design with several parts uses `<assembly>`. Each `<part>` is its own solid in exports — its own
object in 3MF, its own mesh in GLB, its own body in STEP:

```tsx
<assembly name="enclosure">
  <part name="body" color="#2d3640">...</part>
  <part name="lid" color="#e8edf2" z={40}>...</part>
</assembly>
```

## 12. Export

```sh
tscad build shelf.tsx -o shelf.step   # exact B-rep (AP242)
tscad build shelf.tsx -o shelf.stl    # binary STL
tscad build shelf.tsx -o shelf.3mf    # 3MF with colours, one object per part
tscad build shelf.tsx -o shelf.glb    # glTF binary
tscad build shelf.tsx -o shelf.obj
```

The format comes from the file extension; pass several `-o` to write several files from one
evaluation. Mesh formats are tessellated at a 0.01 mm chord tolerance by default (`-t` changes
it), `--part` exports only some parts, and `--ascii` writes ASCII STL.

| Format | Notes |
|---|---|
| STEP | exact geometry; opens in any CAD tool as solids you can edit further |
| STL | all parts in one file, binary by default |
| 3MF | millimetres, one object per part, part colours as base materials |
| GLB | glTF 2.0: Z-up converted to Y-up and millimetres to metres by the root node, PBR colour per part |
| OBJ | one `o` group per part, vertex normals |

## 13. Using tscad from code

Everything the CLI does is a library call, and works the same in bun and in a browser:

```ts
import { renderModule } from "tscad"
import { loadKernel } from "tscad/kernel"
import { exportModel, toSTL } from "tscad/export"
import * as shelf from "./shelf.tsx"

const { document } = renderModule(shelf, { length: 120 })   // TSX → IR
const kernel = await loadKernel()                           // the wasm kernel
const result = await kernel.evaluate(document)              // IR → B-rep
console.log(result.parts.map((p) => `${p.name}: ${p.volume} mm³`))

const parts = document.parts!.map((p) => ({ name: p.name!, color: p.color }))
await Bun.write("shelf.step", await exportModel(kernel, parts, "step"))
await Bun.write("shelf.3mf", await exportModel(kernel, parts, "3mf"))

// or work with meshes directly
const mesh = await kernel.meshAt("bracket", 0.05)
const stl = toSTL([{ name: "bracket", mesh }])
```

The IR (`tscad/ir`) is plain JSON. You can generate it from anything, store it, diff it, or send
it to a worker.

## 14. When something fails

Evaluation errors carry the path of the IR node that failed, and the compiler's source map ties
that path back to the JSX element that created it — so the viewer and `tscad build` report the
failing `<fillet>` with its file and line instead of pointing into the kernel. Common causes:

- **A fillet that is too big** for the faces next to it — reduce the radius or select fewer edges.
- **A selector that matches nothing** — fillets and chamfers fail when their selector is empty;
  click an edge in the viewer to get a selector that matches it.
- **A profile that crosses itself** — `polygon` points must go around the shape once.
- **A cut that doesn't reach** — a `difference` tool that only touches a face leaves it intact;
  make it a little longer.
- **An empty result** — an `intersection` of things that don't overlap is reported as empty.

If the kernel itself panics (a solidcore bug, not your model), the session is rebuilt
automatically and the error says so. Please report it with the model that triggered it.
