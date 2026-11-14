# tscad architecture & module contracts

tscad is "CAD as TSX": you write parametric solid models as JSX components, tscad compiles the
element tree into an IR ("cad-json"), and the **solidcore** B-rep kernel (Rust, compiled to
WebAssembly) evaluates it into exact solids: meshes for the viewer, STEP/STL/3MF/GLB for export.

```
 your .tsx ──► JSX runtime ──► element tree ──► compile() ──► IR Document ──► KernelHost (wasm)
   (params)     src/jsx-runtime    src/core          src/core      src/ir.ts        src/kernel
                                                                                       │
                                                         meshes / STEP / picks ◄───────┘
                                                         viewer (src/viewer), export (src/export), cli (src/cli)
```

One npm package, `tscad`, with subpath exports (the `@tscad` npm scope is not ours):
`tscad`, `tscad/jsx-runtime`, `tscad/jsx-dev-runtime`, `tscad/kernel`, `tscad/export`, `tscad/ir`.
Bun is the default runtime. Source is shipped as TypeScript (bun runs it directly).

## Directory ownership

| Path | What | Owner |
|---|---|---|
| `crates/tscad-wasm/` | Rust: IR (`ir.rs`), evaluator (`eval.rs`), session (`engine.rs`), wasm-bindgen API (`lib.rs`) | lead |
| `wasm/` | **generated** by `bun run build:wasm` (gitignored): `tscad_wasm.js`, `.d.ts`, `_bg.wasm` | |
| `src/ir.ts` | re-exports the tsify-generated IR types. Never hand-write IR types. | lead |
| `src/kernel/` | `loadKernel()` → `KernelHost` (panic recovery, typed-array meshes) | lead |
| `src/jsx-runtime.ts`, `src/jsx-dev-runtime.ts`, `src/core/`, `src/index.ts` | JSX runtime, intrinsic elements, sketch → curves, selectors, params, compile to IR | core agent |
| `src/viewer/`, `src/cli/` | `tscad` CLI (`init`, `dev`, `build`), dev server, three.js viewer, eval worker | app agent |
| `src/export/` | STL / 3MF / GLB / OBJ writers from `MeshArrays`; STEP passthrough | export agent |
| `examples/`, `README.md`, `docs/` | showcase models and docs | export agent + lead |
| `tests/` | bun tests, one file per area (`tests/core.*.test.ts`, `tests/export.*.test.ts`, ...) | each owner |

Never edit another owner's files; if you need a change there, write it in your final report.
`package.json` deps are preinstalled (`three`, `fflate`, `@types/three`, `typescript`, `bun-types`).
If you truly need another dependency, `bun add` it and say so in your report.

## The IR (source of truth: `crates/tscad-wasm/src/ir.rs`, TS: `src/ir.ts`)

`Document = { parts: Part[] }`, `Part = { name, color?, node: Node }`. `Node` is a tagged union
on `type`:

- primitives: `box {size, center?}` (lower corner at origin unless centred), `cylinder {radius,
  height, center?}` (+Z from base centre), `sphere {radius}`, `cone {bottomRadius, topRadius,
  height, center?}`, `torus {majorRadius, minorRadius}` (about +Z)
- booleans: `union {children}`, `difference {children}` (first minus the rest), `intersection {children}`
- `transform {matrix, children}`: 16 numbers, **row-major, column-vector** (`p' = M p`, translation
  at indices 3, 7, 11). Reflections (det < 0) are allowed (the kernel mirrors properly); uniform
  scale allowed; non-uniform scale/shear turn geometry into NURBS.
- `extrude {profile: Curve[], direction, distance, draft?}`: the profile is ONE closed planar loop of
  curves, end to end, in model space. `draft` radians.
- `revolve {profile, origin, axis, angle}` (angle radians, ≤ 2π)
- `loft {sections: Curve[][], ruled?}`, `sweep {profile, path: Curve[], frame?: "follow"|"translate"}`
- features: `fillet {radius, edges?: Selector, children}`, `chamfer {distance, edges?, children}`,
  `shell {thickness, faces?: Selector, children}` (negative thickness = inward; `faces` are opened)
- `Curve = line {start,end} | arc {center, axis, reference, radius, start, end} (radians, CCW about
  axis, angle 0 along reference) | nurbs {degree, points: [x,y,z,w][], knots}` (clamped knots).
  A full circle is one arc 0..2π.
- `Selector = all | none | parallel{axis} | perpendicular{axis} | max{axis} | min{axis} |
  radius{radius} | within{min,max} | and{of} | or{of} | not{of} | index{indices}`; axis `"x"|"y"|"z"`.
  Edge semantics: parallel = straight edges along the axis; perpendicular = circles about the axis;
  max/min = edges lying wholly at the body's extreme along the axis. Face semantics: parallel =
  planar faces whose normal is ±axis; perpendicular = planar faces whose normal ⟂ axis.

**Node paths.** Errors carry `path` like `parts/0/1/0`: the part index, then the child index at
each level (`children[i]`). Nodes without `children` are leaves. The core compiler must record,
for every IR node it emits, the path it will have and the JSX source location (from
`jsxDEV`'s `source` argument when available) so errors map back to TSX lines.

## Kernel (`src/kernel/index.ts`): available now

```ts
const k = await loadKernel()            // shared session; loadKernel(source) for a new one
await k.evaluate(doc, { tolerance? })   // EvalResult: per part ok/error/volume/area/bbox/counts/millis/cached
await k.mesh("partName")                // MeshArrays | undefined (Float32Array/Uint32Array)
await k.meshAt("partName", 0.01)        // finer mesh for export
await k.step(["a","b"]?)                // STEP AP242 text
await k.pickEdge(part, edgeId)          // PickInfo: kind, points, suggestions: {selector, count}[]
await k.pickFace(part, faceId)
```
The session caches subtrees by structural equality, so re-evaluating after a param change only
recomputes what changed. A kernel panic throws `KernelPanic` and the session is rebuilt.
`MeshArrays.faceIds[tri]` / `edgeIds[polyline]` are record indices usable with `pickFace`/`pickEdge`.

## Core API (`tscad`): owned by the core agent; others code against this

```ts
// JSX: lowercase intrinsic elements (like tscircuit). tsconfig: "jsx": "react-jsx", "jsxImportSource": "tscad"
import { defineParams, edges, faces, compile, type ParamValues } from "tscad"

export const params = defineParams({
  width:  { type: "number", default: 40, min: 10, max: 120, step: 1, unit: "mm", label: "Width" },
  holes:  { type: "int", default: 4, min: 0, max: 12 },
  rounded:{ type: "boolean", default: true },
  style:  { type: "choice", default: "a", options: ["a", "b"] },
})
export default function Bracket(p: ParamValues<typeof params>) { return <part name="bracket">...</part> }

compile(element): { document: Document, sourceMap: Record<string /*node path*/, SourceLoc>, warnings: string[] }
renderModule(mod, overrides?): { document, sourceMap, params: ParamSchema, values }  // mod = imported user module
```

- `renderModule` takes a user module `{ default: Component, params?: ParamSchema }`, merges
  defaults with `overrides`, renders `<Component {...values}/>`, compiles.
- A root that is not a `<part>`/`<assembly>` is wrapped in one part named `"part"`.
- The viewer and CLI only use `renderModule`, `compile`, the `ParamSchema` type and `SourceLoc`.

## Viewer/worker protocol (owned by the app agent)

The dev server (`tscad dev file.tsx`) bundles the user file for the browser with `Bun.build`
on every change and notifies the page over a WebSocket. The page runs a Web Worker that imports
the bundle, calls `renderModule(mod, paramValues)`, evaluates with the kernel and posts meshes
(transferable typed arrays) back. Param slider changes re-run only in the worker (no rebundle),
and the kernel cache makes them fast. The same worker design must be usable for a future static
browser playground (no server-only APIs inside the worker).
