# tscad MCP server

`tscad mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio
(spec 2025-06-18), so Claude (or any MCP client) can design parametric CAD with tscad: read
the element reference, write TSX, evaluate it with the B-rep kernel, look at a rendering, and
export STEP/STL/3MF/GLB/OBJ/DXF/SVG.

## Add it to Claude Code

```sh
claude mcp add tscad -- bunx tscad mcp
```

Inside a project that has tscad installed (`bun add tscad`), use the local copy instead:

```sh
claude mcp add tscad -- bun x tscad mcp
```

Then ask for a part: *"Design a NEMA 17 motor mount plate, 5 mm thick, with counterbored M3
holes, and export it to STEP."* Claude reads the docs, writes the model, evaluates and renders
it, fixes what fails, and writes the file. Relative paths (models, exports) resolve against the
directory Claude Code was started in.

## Add it to Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "tscad": {
      "command": "bunx",
      "args": ["tscad", "mcp"]
    }
  }
}
```

If `bunx` is not on the app's `PATH`, use the absolute path (`which bunx`). Claude Desktop starts
servers in an unspecified working directory, so give absolute paths for `file`, `path` and
`baseDir` (or ask Claude to).

Any other MCP client: run `bunx tscad mcp` as a stdio server (newline-delimited JSON-RPC).

## Tools

| Tool | What it does |
|---|---|
| `tscad_docs` | The authoring guide (default), the element/props reference generated from the type definitions (`topic: "elements"`), the parts library (`topic: "parts"`), or exact props of named elements (`element: "extrude"` or a list). |
| `tscad_list_examples` / `tscad_read_example` | The bundled example models, as templates. |
| `tscad_evaluate` | Compile + evaluate a model (`source` TSX text or `file` path, optional `params`). Per part: ok, volume (mm³), mass (g, from `material`/`density`), size and bounding box, face/edge counts, timings; warnings; params. Errors name the TSX line with a code frame. |
| `tscad_render` | Same, plus a PNG (`view`: iso/front/top/... or `"az,el"`, `width`, `height`, `background`, `ortho`). |
| `tscad_export` | Write `step`, `stl`, `3mf`, `glb`, `obj`, `dxf` or `svg` to `path`; returns the path and size. DXF/SVG come from `<drawing>`s, or else a section of each part at `sectionZ` (default mid-height). |
| `tscad_plate` | Print layout: orients each part for least overhang (or `orient: "keep"`) and packs parts and `copies` onto as many `bed`s as needed. Returns part, plate, bottom face, overhang % and height; with `path` writes a 3MF (orientation notes per object) or STL per plate. |
| `tscad_check` | Design checks: 3D-printing overhangs (faces steeper than `maxOverhangDeg`, with their location and a selector), the thinnest wall and where it is, bed fit (`bed`), watertight meshes, and interference between parts (the volume and location of each overlap). |
| `tscad_pick_selectors` | The edge (or face) nearest a `point` (or by `index`) and selectors that pick it (`">X and >Z"` / `edges.max("x").and(edges.top())`), with how many each selects. For `edges=` on `<fillet>`/`<chamfer>` and `open=` on `<shell>`. |

Every model tool takes:

- `source`: the model's TSX (a module with a default-exported component), **or** `file`: a path.
- `params`: overrides for the model's `defineParams` values.
- `baseDir`: the directory for relative paths. With `source`, the model is written there as a hidden
  temporary file so its relative imports (`./parts.tsx`, `./logo.step`) resolve; without it,
  `source` models run from a temp directory and can only import `tscad` and `tscad/*`.

Tool failures (a model that doesn't compile, a kernel error) come back as results with
`isError: true` and a readable message, so the agent can fix the model and retry. Calls are
evaluated one at a time on one kernel session, which caches unchanged subtrees between calls.

## Notes

- The server writes nothing but JSON-RPC to stdout; `console.log` from models is captured and
  returned with the evaluate result, and diagnostics go to stderr.
- Programmatic use: `import { runMcpServer, createMcpHandler } from "tscad/mcp"`.
  `runMcpServer({ stdin, stdout })` serves any byte stream; `createMcpHandler()` handles one
  parsed message at a time (handy for tests or other transports).
