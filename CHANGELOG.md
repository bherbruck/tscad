# Changelog

All notable changes to tscad. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

## [0.1.0] - 2026-11-14

The first release: CAD as TSX.

### Modelling

- **JSX runtime with no React.** Function components run at compile time. Fragments, keys and
  `createContext`/`useContext` all work. Source locations are captured for every element, so
  errors and kernel failures point at TSX lines.
- **Primitives:** `<box>`, `<cylinder>`, `<cone>`, `<sphere>`, `<torus>`. Box, cylinder and
  cone are centred in X/Y with their base on z = 0.
- **Booleans:** `<union>`, `<difference>` (`<subtract>`), `<intersection>` (`<intersect>`).
- **Transforms:** `<translate>`, `<rotate>`, `<scale>`, `<mirror keep>` and `<transform matrix>`,
  plus placement props on every solid (`x y z at rotate rotateX/Y/Z scale mirror`).
- **Patterns:** `<linearPattern>`, `<gridPattern>`, `<polarPattern>`.
- **Features:**
  - `<fillet>`, `<chamfer>`, `<shell>`
  - `<draft>` (mould draft)
  - `<pushPull>` / `<offsetFaces>` (move faces)
  - `<split>` (cut with a plane, keep one side)
- **Selectors** for edges and faces: a chainable builder (`edges.top().circles()`),
  CadQuery-style strings (`">Z or |Z"`), or raw IR.
- **Sketches:**
  - Shapes: `<rect>`, `<roundedRect>`, `<circle>`, `<ellipse>`, `<polygon>`,
    `<regularPolygon>`, `<slot>`, `<star>`.
  - `<path d>` takes an SVG path subset; curves stay exact arcs and NURBS.
  - `<text>` uses opentype.js with an embedded DejaVu Sans subset, or a user font.
  - `<offset>` gives 2D offsets with exact arcs.
  - `<hull>` gives the exact convex hull: tangent lines and true arcs.
  - 2D booleans `<sketchUnion>`, `<sketchDifference>` and `<sketchIntersection>` (aliases
    `<union2d>`, `<difference2d>`, `<intersection2d>`): exact over lines and arcs, fuzzed with
    42k cases.
  - `<sketch>` groups shapes.
  - Nested loops become holes automatically.
- **Sketch → solid:** `<extrude>` (planes, draft, centre), `<revolve>`, `<loft>`, `<sweep>`
  along `helix()`, `polyline3()`, `arc3()` or `bezier3()`.
- **Constraint sketches.** Points, lines, arcs, circles and splines, 17 constraint kinds and
  dimensions, solved by Levenberg–Marquardt. Degree-of-freedom and conflict diagnostics point
  at TSX lines. Typed refs (`sketchRefs`) can be used with string ids, and `sketchPath()` is a
  fluent path builder.
  - In-sketch patterns stay constrained: `mirrorEntities`, `circularPattern`, and
    `linearPattern of`.
  - Branch hints pick between solutions: an arc's major or minor side, which side a tangent
    falls, and loop preference.
  - Sketches drive sweeps (`<sweepPath>`) and lofts.
- **Assemblies.**
  - `<anchor>` and `<mate>`: fastened, revolute, slider, cylindrical, planar, ball.
  - `<gear>` couples joints.
  - Joint limits, nested sub-assemblies, and `assemblyRefs` for typed refs.
- **Parts and materials:** `<part name color material density visible>`, `<assembly>`,
  `<group>`, and `<step data>` (STEP import). There are material presets with densities for
  mass.
- **Flat parts:** `<drawing name layer? thickness?>` holds 2D parts for laser cutting and CNC.
- **Parameters:** `defineParams` with `number | int | boolean | choice | text | color`.
  `ParamValues` infers types, including choices as literal unions. Values are coerced and
  clamped.

### Packages

- **`tscad/kernel`:** the solidcore B-rep kernel in WebAssembly. It evaluates with a subtree
  cache, meshes, writes STEP AP242, picks edges and faces with selector suggestions, and
  recovers from panics.
  - An optional native build (`bun scripts/build-native.ts`, through `bun:ffi`) is 2–3×
    faster, and `loadKernel` picks it up automatically.
  - With the native build, multi-part models evaluate on a pool of kernel processes in
    `build`, `info`, `render` and `dev` (min(parts, cores − 1, 4); `TSCAD_PARALLEL=0` turns it
    off; skipped for STEP output). `tscad build` of the enclosure: 4.24 → 2.38 s.
- **`tscad/export`:** STL, 3MF (with colours), GLB, OBJ and STEP.
- **`tscad/render`:** a headless PNG renderer in pure TypeScript, with studio lighting, edges
  and shadow.
- **`tscad/drawing`:** DXF R12 (real arcs, or closed polylines with bulges) and SVG; plane
  sections of meshes.
- **`tscad/parts`:** ISO metric holes (clearance, counterbore, countersink, tap), nut traps,
  heat-set insert pockets, standoffs, mounting patterns (Raspberry Pi 4 and Zero, Arduino Uno,
  NEMA 17/23), 2020 extrusion, hex prisms, and the `metric` data table. Laser-cut generators:
  `<FingerJointBox>` (finger joints, kerf, lid, dividers, flat or assembled) and
  `<LivingHinge>`. Drawings take a `layer` (CUT and ENGRAVE in DXF and SVG). Board models
  (`boards.*`: Raspberry Pi 5/4/Zero 2 W/Pico, Arduino Uno, ESP32-DevKitC) with connector
  anchors, and generated enclosures (`<BoardCase>`).
- **`tscad/check`:** overhangs per triangle and face, wall thickness by BVH ray casting, bed
  fit, interference between parts, watertightness.
- **`tscad/testing`:** `evaluateModel`; the matchers `toEvaluate`, `toHaveVolume`, `toFitIn`,
  `toHaveNoInterference` and `toBePrintable`; parameter sweeps (`paramCombos`, latin
  hypercube).
- **`tscad/mcp`:** an MCP server (protocol 2025-06-18) with tools to evaluate, render, check,
  export, pick selectors, read examples, and read docs generated from the types.
  - `tscad_check` suggests a better print orientation.
  - Errors carry fix-it hints and TSX locations.
  - [docs/mcp-dogfood.md](docs/mcp-dogfood.md) describes five models an agent designed through
    it ([examples/agent](examples/agent)).
- **`tscad/convert`:** OpenSCAD → tscad. Customizer variables become params and modules become
  components. It covers `hull`, `minkowski`, `multmatrix` and `resize`, and keeps 2D booleans in
  2D. Geometric equivalence tests cover it.

### Tools

- **CLI:** `tscad init`, `dev` (live viewer with hot reload), `build` (step, stl, 3mf, glb,
  obj, dxf, svg), `info`, `render`, `convert`, `mcp`.
  - `tscad dev` evaluates on the server with the native kernel when it's available, and falls
    back to the browser, where parts also evaluate in parallel (up to 4 wasm kernels).
  - `tscad dev <folder>` (or a folder without `index.tsx`) serves a gallery of every model in the
    tree: thumbnails, doc-comment titles and descriptions, parts, volume and error badges, with
    filter and sort. Thumbnails are cached in `.tscad/cache/` (which `tscad init` gitignores).
  - `tscad plate` orients each part for the least overhang and packs parts (and copies) onto
    as many beds as needed, writing a 3MF (with per-object orientation notes) or STL per plate.
    The viewer has the same as Plate mode (`P`), and MCP has `tscad_plate`.
  - `tscad render <folder> -o <dir>` renders every model to `<dir>/<path>.png` through the same
    cache, and `tscad render file --json` prints each part's status and volume.
- **Viewer:**
  - param sliders, pick-to-selector, section and measure tools, export;
  - sketch overlays (dimensions, free points, patterns) with click-to-source;
  - assembly gizmos with drag-to-drive joints and an explode slider;
  - heatmaps for overhangs, wall thickness and interference;
  - geometry diff (`D` or the ± button): added material green, removed red (exact kernel
    booleans), a Diff panel with per-part added/removed mm³, Δvolume and Δsize, and **Pin**
    to keep a baseline for A/B comparisons.
- **Playground:** a static in-browser editor with autocompletion, error squiggles, share links
  and **Import .scad**. Share links carry text-imported files (`files=` next to `code=`), so
  models like engraved-logo that import an SVG share whole.
- **VS Code extension** (`editors/vscode`, not yet on the Marketplace):
  - a live preview beside the editor;
  - squiggles for compile, kernel and sketch problems;
  - export CodeLenses, click-to-source and snippets.
- **Docs site:** landing page, guides, a cookbook, an element and parts reference generated
  from TSDoc, and a gallery.

### Known limitations

See [docs/KERNEL_ISSUES.md](docs/KERNEL_ISSUES.md):

- On WebAssembly, booleans take around a second on a first build (the native kernel is 2–3×
  faster).
- Helix sweeps are slow or not closed, and sharp-corner sweep paths fail.
- Inward shells fail across tangent walls.
- STEP import fails on blended corners.
