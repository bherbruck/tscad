# Getting started

tscad turns TypeScript + JSX into exact solid models. You describe a part as a function
component made of lowercase elements (`<box>`, `<extrude>`, `<fillet>`), and tscad compiles it
to an IR that the **solidcore** B-rep kernel (Rust, compiled to WebAssembly) turns into exact
geometry: STEP for CAD, STL/3MF for printing, GLB/OBJ for the web, DXF/SVG for laser cutters.

All lengths are **millimetres**, all angles **degrees**, and **Z is up**.

## Try it without installing

The [playground](../play/) runs everything in your browser: editor, kernel and viewer. Pick an
example, change a number, and the model rebuilds. Share links carry the source in the URL.

## Install

tscad runs on [Bun](https://bun.sh) (≥ 1.2).

```sh
bunx tscad init my-part
cd my-part
bun install          # installs tscad locally, so your editor gets its types
bunx tscad dev --open
```

`tscad init` writes `index.tsx`, `package.json`, `tsconfig.json`, `.gitignore` and a
`README.md`. `tscad dev` serves a live viewer at http://localhost:3333 that rebuilds on every
save: orbit the model, drag parameter sliders, click an edge to get a selector for it, and
export from the **Export** button (top right).

`tscad dev` evaluates models in the dev server with the native kernel when one is built for
your platform, and otherwise in the browser with WebAssembly (parts evaluate in parallel
either way). The banner says which; `--browser-eval` forces the browser.

Press **D** (or the ± button) for the geometry diff: after every param or code change, the
material the change added shows in green and what it removed in red, and the Diff panel lists
each part's added and removed mm³. **Pin** keeps the current version as the baseline, so you
can drag a slider and compare against it.

Using VS Code? The extension in [`editors/vscode`](https://github.com/bherbruck/tscad/tree/main/editors/vscode)
(not yet on the Marketplace) puts this viewer beside the editor, with squiggles on failing
elements and export CodeLenses.

To add tscad to an existing project:

```sh
bun add tscad
```

and point the JSX transform at it in `tsconfig.json`:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "tscad" } }
```

## Your first model

A model file default-exports a component. `defineParams` declares the knobs the viewer turns
into sliders, and types the props:

```tsx
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 60, min: 30, max: 120, unit: "mm" },
  holes: { type: "int", default: 3, min: 1, max: 6 },
})

export default function Plate({ width, holes }: ParamValues<typeof params>) {
  return (
    <part name="plate" material="pla">
      <fillet radius={3} edges={edges.vertical()}>
        <extrude height={4}>
          <rect w={width} h={30} />
          {Array.from({ length: holes }, (_, i) => (
            <circle key={i} r={2.2} x={(i - (holes - 1) / 2) * 15} />
          ))}
        </extrude>
      </fillet>
    </part>
  )
}
```

Circles drawn inside the rectangle become **holes** automatically: loops nested inside other
loops are subtracted.

## Build and export

```sh
bunx tscad build index.tsx -o plate.step -o plate.stl   # several formats at once
bunx tscad build index.tsx -o plate.3mf -p width=80     # override a parameter
bunx tscad info index.tsx                               # params, volumes, masses
bunx tscad render index.tsx -o plate.png --view iso     # a PNG, no browser needed
bunx tscad render models/ -o images/                     # every model in a folder (cached)
bunx tscad plate index.tsx -o plate.3mf --copies leg=4  # oriented and packed for printing
```

Formats: `step` (exact B-rep, AP242), `stl`, `3mf` (with colours), `glb`, `obj`. `dxf` and `svg`
give flat [`<drawing>`](../reference/elements.html#drawing) parts; for solids they give a section
at mid-height (`--section-z <mm>` picks the height).

## Coming from OpenSCAD

```sh
bunx tscad convert box.scad -o box.tsx
```

Customizer variables become typed params, and modules become components. In the playground,
**Import .scad** does the same. See [Converting OpenSCAD](convert.html).

## Design with an AI agent

`tscad mcp` is an MCP server: Claude (or any MCP client) can read the reference, write the TSX,
evaluate it with the kernel, look at renders and export files.

```sh
claude mcp add tscad -- bunx tscad mcp
```

See [MCP server](mcp.html).

## Where next

- The [guide](guide.html) builds a real bracket step by step: placement, booleans, sketches,
  fillets and selectors, patterns, components, parameters and assemblies.
- The [element reference](../reference/elements.html) lists every element and prop.
- The [parts library](../reference/parts.html) has ISO fastener holes, nut traps, standoffs and
  mounting patterns.
- The [gallery](../gallery/index.html) has complete example models to copy from.
