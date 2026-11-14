# API reference

tscad is one package with subpath exports. Everything is typed, and hovering in your editor
shows the same documentation. Lengths are **mm**, angles are **degrees**, Z is up.

| Import | For | Runs in |
|---|---|---|
| [`tscad`](#tscad) | writing models: params, selectors, paths, units, compile | anywhere |
| [`tscad/parts`](#tscadparts) | the standard component library (ISO holes, hardware, patterns) | anywhere |
| [`tscad/kernel`](#tscadkernel) | evaluating the IR with the B-rep kernel (WebAssembly) | bun, browser |
| [`tscad/export`](#tscadexport) | STEP / STL / 3MF / GLB / OBJ | bun, browser |
| [`tscad/render`](#tscadrender) | headless PNG renders | bun, browser |
| [`tscad/drawing`](#tscaddrawing) | DXF / SVG for laser and CNC, mesh sections | bun, browser |
| [`tscad/check`](#tscadcheck) | printability, interference, watertightness | bun, browser |
| [`tscad/testing`](#tscadtesting) | `bun:test` helpers and matchers | bun |
| [`tscad/mcp`](#tscadmcp) | the MCP server for AI agents | bun |
| [`tscad/convert`](#tscadconvert) | OpenSCAD → tscad | anywhere |
| [`tscad/ir`](#tscadir) | IR types (`Document`, `Node`, `Curve`, `Selector`) | types only |
| `tscad/jsx-runtime`, `tscad/jsx-dev-runtime` | the JSX runtime (set `"jsxImportSource": "tscad"`) | anywhere |

The elements themselves (`<box>`, `<extrude>`, ...) are listed in the
[element reference](../reference/elements.html).

## `tscad`

### Models and compiling

| Export | |
|---|---|
| `compile(element, options?)` | Element tree → `CompileResult`: `{ document, sourceMap, warnings, parts, drawings, sketches, assembly? }`. Throws `TscadError` for modelling errors. |
| `renderModule(mod, overrides?, options?)` | Render a model module `{ default, params? }` with param overrides, coerced and clamped, then compile it. Returns `RenderResult` = `CompileResult` + `{ params, values, paramIssues }`. |
| `TscadModule`, `CompileResult`, `RenderResult`, `CompileOptions`, `PartInfo`, `Drawing` | result types. `PartInfo` = `{ name, color?, material?, density?, visible, index, loc? }`. |
| `sourceMap` | IR node path (`parts/0/1/0`, the kernel's numbering) → `SourceLoc { file, line, column, tag?, component? }`. |
| `TscadError` | `.loc`, `.hint`, `.detail` (the message without location), `.path`. |
| `formatLoc(loc)` | `file:line:col`. |

### JSX, components, context

| Export | |
|---|---|
| `createElement(type, props, ...children)` | JSX without JSX. |
| `Fragment`, `isElement(x)` | |
| `createContext(default)`, `useContext(ctx)` | React-style context, resolved while compiling. |
| `setSourceCapture(on)` | Turn off stack-based source locations (about 3 µs per element) for huge generated models. |
| `Element`, `Component<P>`, `FC<P>`, `Children`, `Child`, `Key` | types |

### Parameters

```ts
export const params = defineParams({
  width: { type: "number", default: 40, min: 10, max: 120, step: 1, unit: "mm", label: "Width", group: "Size" },
  holes: { type: "int", default: 4, min: 0, max: 12 },
  rounded: { type: "boolean", default: true },
  style: { type: "choice", default: "round", options: ["round", "square"] },
  label: { type: "text", default: "tscad", maxLength: 12 },
  tint: { type: "color", default: "#4f7cac" },
})
export default function Model(p: ParamValues<typeof params>) { /* p.style: "round" | "square" */ }
```

| Export | |
|---|---|
| `defineParams(schema)` | Type-checks the schema; for example, a choice's `default` must be one of its `options`. |
| `ParamValues<S>`, `ParamValue<Spec>`, `ParamSchema`, `ParamSpec`, `NumberParam` … `ColorParam` | types |
| `resolveParams(schema, overrides)` | → `{ values, issues }`. Coerces strings (from URLs or the CLI) and clamps to `min`/`max`. |
| `coerceParam(spec, value)` | One value → `{ value, message? }`. |
| `paramDefaults(schema)`, `paramLabel(key, spec)` | Defaults; display label (`wallThickness` → "Wall thickness"). |

### Selectors

`edges` and `faces` (class `Sel`) give `.top() .bottom() .vertical() .circles(axis?) .radius(r)
.parallel(axis) .perpendicular(axis) .max(axis) .min(axis) .within(min, max) .index(...)`,
chained with `.and() .or() .not()`. Strings work too: `">Z or |Z"`. See
[Selectors](../docs/selectors.html). Also exported: `parseSelector(string)`, `toSelector(like)`,
`SelectorSyntaxError`, and the type `SelectorLike`.

### Paths, units, materials, text

| Export | |
|---|---|
| `helix({ radius, pitch, turns \| height, leftHanded?, segmentsPerTurn?, z? })` | A C¹ cubic NURBS helix (radial error about 4e-6 × r). |
| `polyline3(points, closed?)`, `line3(a, b)`, `arc3({ center?, radius, start?, end?, axis?, reference? })`, `bezier3(points)`, `path3(...paths)` | 3D paths for `<sweep path>`. |
| `mm cm meters inch ft thou` | → mm. `deg`, `rad` (radians → degrees), `turn` (turns → degrees). |
| `range(n)`, `linspace(a, b, n)` | loop helpers |
| `materials`, `massOf(volumeMm3, density)` | Presets (`pla`, `petg`, `abs`, `aluminum`, `steel`, `brass`, `wood`, …): `{ name, density g/cm³, color }`. |
| `layoutText(text, font, layout)`, `loadFont(bytes)`, `getDefaultFont()` | The text engine behind `<text>`. |

### Sketches and assemblies

`sketchPath()` (a fluent path builder whose `.d` goes into `<path d>`), `sketchRef` and
`sketchRefs` (handles for constraint sketches). For assemblies: `anchorRef`, `assemblyRefs`,
and `isAnchorRef`. See [Constraint sketches](../docs/sketch.html) and [Assemblies](../docs/assembly.html).

## `tscad/parts`

The parts library has fastener holes as cutting tools pointing −Z from z = 0
(`Hole`, `CounterboreHole`, `CountersinkHole`, `TapHole`), hardware (`NutTrap`, `HeatSetInsert`,
`Standoff`), patterns (`BoltPattern`, `MountHoles`, `mountPatterns`), profiles (`Extrusion2020`,
`HexPrism`), and ISO data (`metric`, `metricData(size)`, `metricSizes`). Each component's props
are in the [parts reference](../reference/parts.html).

## `tscad/kernel`

```ts
const kernel = await loadKernel()                 // shared session; loadKernel(wasm) for another
const r = await kernel.evaluate(document, { tolerance?, noMesh? })
r.parts                                           // { name, ok, empty, error?, volume, area, bbox, counts, warnings, millis, cached }[]
await kernel.mesh("part")                         // MeshArrays (typed arrays) of the last evaluation
await kernel.meshAt("part", 0.01)                 // finer mesh, for export
await kernel.step(["part"])                       // STEP AP242 text
await kernel.pickEdge("part", i)                  // { kind, points, radius?, direction?, suggestions: { selector, count }[] }
await kernel.pickFace("part", i)
```

The session caches subtrees by structural equality: unchanged parts of the tree are not
recomputed. When a native build exists (`bun scripts/build-native.ts`, written to
`native/<platform>-<arch>/`), `loadKernel()` uses it through `bun:ffi`; it's 2–3× faster than
the WebAssembly build. `TSCAD_NATIVE_LIB` points at a library elsewhere. A kernel panic throws `KernelPanic`, and the session is rebuilt.
`MeshArrays` = `{ positions, normals, indices, faceIds, edgePoints, edgeCounts, edgeIds }`.

## `tscad/export`

`exportModel(kernel, parts, format, { tolerance? = 0.01, binary? })` → `Uint8Array | string` for
`"step" | "stl" | "3mf" | "glb" | "obj"`. The individual writers `toSTL(parts, { binary })`,
`to3MF`, `toGLB` and `toOBJ` take `{ name, color?, mesh }[]`. Constants: `EXPORT_FORMATS`,
`MIME_TYPES`, `DEFAULT_EXPORT_TOLERANCE`.

## `tscad/render`

`renderPNG(parts, { width = 1200, height = 800, view = "iso", background = "dark", edges = true,
projection, shadow, margin, ssaa })` → PNG bytes. `renderImage` gives raw RGBA. `view` is a
named view (`iso`, `front`, `top`, …) or `{ azimuth, elevation }` in degrees.

## `tscad/drawing`

| Export | |
|---|---|
| `toDXF(drawings, { entities: "primitives" \| "polyline", tolerance = 0.01, layer })` | DXF R12, mm, one layer per drawing, real ARCs (or closed POLYLINEs with arc bulges). |
| `toSVG(drawings, { stroke, strokeWidth = 0.1, fill = "none", margin = 1, tolerance })` | Sized in mm, true arcs, an even-odd path per drawing. |
| `section(mesh, { origin, normal })` | → `{ loops, open }`: a plane cut of a mesh, in the plane's 2D frame (`planeFrame(normal)`). |
| `sectionToDXF`, `sectionToSVG` | a section written straight out |
| `svgPathData(loops, tolerance, closed = true)`, `polylineLoops(polylines)` | building blocks |

The inputs are `compile(...).drawings` (from `<drawing>` elements), loops, or `{ name, loops }`.
A `Drawing` can also carry open `paths` (chains that are never closed, such as sheet-metal bend
lines: LINE/ARC or an open POLYLINE in DXF, an unfilled `<path>` in SVG) and `notes`
(`DrawingNote { at, text, size, angle? }`: real TEXT entities in DXF, `<text>` in SVG), both
included in the bounds.

## `tscad/check`

| Export | |
|---|---|
| `checkPrintability(mesh, { buildDir = [0,0,1], maxOverhangDeg = 45, minWall = 0.8, bed?, skipThickness? })` | Overhangs (per triangle `severity`, grouped by face), wall thickness (`byTriangle`, `byVertex`, `min`), bed fit, `warnings`. |
| `await checkInterference(kernel, document, { minVolume = 1e-3, restore = true, parts? })` | The shared volume of every pair of parts whose bounding boxes overlap. |
| `checkWatertight(mesh)` | Open, non-manifold and flipped edges, shells, Euler characteristic. |
| `buildBvh(positions, indices)`, `raycast(bvh, origin, dir)` | The ray-casting core. |

See [Checks & testing](../docs/checks.html).

## `tscad/testing`

`evaluateModel(model, params?)` → `ModelResult`, which has `ok`, `volume()`, `mass()`,
`size()`, `bbox()`, `mesh()`, `printability()`, `watertight()` and `interference()`. The
matchers `toEvaluate`, `toHaveVolume`, `toFitIn`, `toHaveNoInterference` (async) and
`toBePrintable` are registered on import. `paramCombos(schema, { method, samples, seed, max,
only, fixed })` and `forEachParamCombo` generate parameter sweeps. See
[Checks & testing](../docs/checks.html).

## `tscad/mcp`

`runMcpServer({ stdin?, stdout?, log? })` serves MCP over stdio; it is the same server as
`tscad mcp`. `createMcpHandler()` handles one parsed message at a time. `TOOLS` lists the tool
definitions. `elementsMarkdown()`, `partsMarkdown()`, `lookupReference(name)` and
`referenceEntries()` give the generated element reference. See [MCP server](../docs/mcp.html).

## `tscad/convert`

`convertScad(source, { name })` → `{ tsx, warnings }`. It turns an OpenSCAD model into a tscad
module: Customizer variables become `defineParams`, modules become components, and 2D booleans
under `linear_extrude` become sketch booleans. A source that doesn't parse throws
`ScadSyntaxError`, with the line. The CLI is `tscad convert in.scad -o out.tsx`. See
[Converting OpenSCAD](../docs/convert.html).

## `tscad/ir`

The IR types are generated from the Rust kernel: `Document`, `Part`, `Node`, `Curve`,
`Selector`, `Axis`, `EvalResult`, `PartResult`, `PickInfo`. See
[Architecture](../docs/architecture.html).
