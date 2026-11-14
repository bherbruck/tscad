# Changelog

All notable changes to tscad. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

## [0.1.0] — 2026-11-14

The first release: CAD as TSX.

### Modelling

- **JSX runtime with no React.** Function components run at compile time. Fragments, keys and
  `createContext`/`useContext` all work. Source locations are captured for every element, so
  errors and kernel failures point at TSX lines.
- **Primitives:** `<box>`, `<cylinder>`, `<cone>`, `<sphere>`, `<torus>`. Box, cylinder and
  cone are centred in X/Y with their base on z = 0.
- **Booleans:** `<union>`, `<difference>` (`<subtract>`), `<intersection>` (`<intersect>`).
- **Transforms:** `<translate>`, `<rotate>`, `<scale>`, `<mirror keep>`, plus placement props on
  every solid (`x y z at rotate rotateX/Y/Z scale mirror`).
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
  - `<sketch>` groups shapes.
  - Nested loops become holes automatically.
- **Sketch → solid:** `<extrude>` (planes, draft, centre), `<revolve>`, `<loft>`, `<sweep>`
  along `helix()`, `polyline3()`, `arc3()` or `bezier3()`.
- **Constraint sketches.** Points, lines, arcs, circles and splines, 17 constraint kinds and
  dimensions, solved by Levenberg–Marquardt. Degree-of-freedom and conflict diagnostics point
  at TSX lines. Typed refs (`sketchRefs`) can be used with string ids, and `sketchPath()` is a
  fluent path builder.
- **Assemblies.**
  - `<anchor>` and `<mate>`: fastened, revolute, slider, cylindrical, planar, ball.
  - `<gear>` couples joints.
  - Joint limits, nested sub-assemblies, and `assemblyRefs` for typed refs.
- **Parts and materials:** `<part name color material density visible>`, `<assembly>`,
  `<group>`, and `<step data>` (STEP import). There are material presets with densities for
  mass.
- **Flat parts:** `<drawing name thickness?>` holds 2D parts for laser cutting and CNC.
- **Parameters:** `defineParams` with `number | int | boolean | choice | text | color`.
  `ParamValues` infers types, including choices as literal unions. Values are coerced and
  clamped.

### Packages

- **`tscad/kernel`:** the solidcore B-rep kernel in WebAssembly. It evaluates with a subtree
  cache, meshes, writes STEP AP242, picks edges and faces with selector suggestions, and
  recovers from panics.
- **`tscad/export`:** STL, 3MF (with colours), GLB, OBJ and STEP.
- **`tscad/render`:** a headless PNG renderer in pure TypeScript, with studio lighting, edges
  and shadow.
- **`tscad/drawing`:** DXF R12 (real arcs, or closed polylines with bulges) and SVG; plane
  sections of meshes.
- **`tscad/parts`:** ISO metric holes (clearance, counterbore, countersink, tap), nut traps,
  heat-set insert pockets, standoffs, mounting patterns (Raspberry Pi 4 and Zero, Arduino Uno,
  NEMA 17/23), 2020 extrusion, hex prisms, and the `metric` data table. Laser-cut generators:
  `<FingerJointBox>` (finger joints, kerf, lid, dividers, flat or assembled) and
  `<LivingHinge>`. Drawings take a `layer` (CUT and ENGRAVE in DXF and SVG).
- **`tscad/check`:** overhangs per triangle and face, wall thickness by BVH ray casting, bed
  fit, interference between parts, watertightness.
- **`tscad/testing`:** `evaluateModel`; the matchers `toEvaluate`, `toHaveVolume`, `toFitIn`,
  `toHaveNoInterference` and `toBePrintable`; parameter sweeps (`paramCombos`, latin
  hypercube).
- **`tscad/mcp`:** an MCP server (protocol 2025-06-18) with tools to evaluate, render, check,
  export, pick selectors, read examples, and read docs generated from the types.

### Tools

- **CLI:** `tscad init`, `dev` (live viewer with hot reload), `build` (step, stl, 3mf, glb,
  obj, dxf, svg), `info`, `render`, `mcp`.
- **Viewer:** param sliders, pick-to-selector, section and measure tools, sketch overlays,
  export.
- **Playground:** a static in-browser editor with autocompletion, error squiggles and share
  links.
- **Docs site:** landing page, guides, an element and parts reference generated from TSDoc, and
  a gallery.

### Known limitations

See [docs/KERNEL_ISSUES.md](docs/KERNEL_ISSUES.md):

- Booleans take around a second on a first build.
- Helix sweeps are slow or not closed, and sharp-corner sweep paths fail.
- Inward shells fail across tangent walls.
- STEP import fails on blended corners.
