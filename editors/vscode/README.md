# tscad for VS Code

Live 3D preview and kernel diagnostics for [tscad](https://github.com/bherbruck/tscad) models: parametric solids written as TSX.

## What it does

- **Preview beside the editor.** Run **tscad: Open Preview** (`Ctrl+K V` / `Cmd+K V`, or the preview button in the editor title bar). Opening a `.tsx` file that imports `tscad` and has a default export opens the preview automatically (`tscad.autoOpenPreview`). The preview is the full tscad viewer: orbit, sections, measurements, a param slider panel, the sketch and assembly overlays and the check heatmaps. It follows the active editor: switch to another model and the preview shows it (`tscad.followActiveEditor`). Slider values stay in the preview (they live in its URL), so your code keeps its defaults.
- **Diagnostics.** After every save the model is rendered and evaluated, and problems show up as squiggles on the JSX element that caused them. These cover compile errors, render errors (bad props), kernel failures (a fillet that can't be built) and failed mates. Under-constrained sketches show as information, with the degrees of freedom still free. Turn this off with `tscad.diagnostics`.
- **CodeLens** above the default export: **▶ Preview · Export STEP · Export STL · Export 3MF**. An export is written next to the model with its default params. **tscad: Export…** offers every format (STEP, STL, 3MF, GLB, OBJ, DXF, SVG).
- **Click to source.** In the preview, clicking a sketch dimension label selects the prop that sets it (for example `length={p.width}`). Clicking a sketch, a mate or an error location selects that element in the editor.
- **Snippets** (in `.tsx`): `tscad-model`, `params`, `part`, `extrude`, `extrude-sketch`, `fillet`, `chamfer`, `shell`, `assembly`, `difference`.

## How it works

The extension starts one `tscad dev` server per workspace folder, runs it with `--root <folder> --diagnostics --port 0`, and frames its viewer in a webview. If you already run `tscad dev --root <folder>` yourself, the extension uses that server and leaves it running. The servers it starts are stopped when VS Code closes the window. They also exit on their own if the extension host goes away.

The CLI comes from, in order:

1. the `tscad.command` setting (for example `bunx tscad`),
2. the workspace's `node_modules/tscad`,
3. `bunx tscad`.

[Bun](https://bun.sh) must be installed.

With the native kernel built, models are evaluated in the dev server (see `tscad dev --help`). Otherwise they are evaluated in the preview with WebAssembly.

## Settings

| Setting | Default | |
|---|---|---|
| `tscad.autoOpenPreview` | `true` | Open the preview when a model is opened |
| `tscad.followActiveEditor` | `true` | The preview shows the model in the active editor |
| `tscad.command` | `""` | Command that runs the tscad CLI |
| `tscad.diagnostics` | `true` | Squiggles for compile, kernel and sketch problems |
| `tscad.codeLens` | `true` | Preview/Export lenses above the default export |

## Building

```sh
cd editors/vscode
bun install
bun run build      # dist/extension.js
bun run package    # tscad-vscode-<version>.vsix (install with "Extensions: Install from VSIX…")
```
