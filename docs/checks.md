# Design checks and model tests

Two modules help you trust a parametric model across all its parameters:

- **`tscad/check`**: checks on meshes and the kernel. It finds overhangs, measures wall
  thickness, checks bed fit, finds interference between parts, and checks that meshes are
  watertight. It is browser-safe and returns plain data, with typed arrays for viewer heatmaps.
- **`tscad/testing`**: helpers and matchers for `bun:test`. Evaluate a model, assert on it, and
  sweep its parameter space.

## Testing a model

```tsx
// bracket.test.tsx
import { describe, expect, test } from "bun:test"
import { evaluateModel, paramCombos } from "tscad/testing" // registers the matchers
import * as bracket from "./bracket"

describe("bracket", () => {
  test("defaults", async () => {
    const r = await evaluateModel(bracket)
    expect(r).toEvaluate()
    expect(r).toFitIn([60, 40, 45])
    expect(r).toBePrintable({ minWall: 0.8, bed: [220, 220, 250] })
  }, 60_000)

  test.each(paramCombos(bracket.params, { samples: 3 }))("evaluates for %o", async (p) => {
    const r = await evaluateModel(bracket, p)
    expect(r).toEvaluate()
    expect(r.size()[0]).toBeCloseTo(p.width, 3)
  }, 60_000)
})
```

Run it with `bun test`. A full example is in [`examples/bracket.test.tsx`](../examples/bracket.test.tsx).
Kernel evaluations take a second or more, so give model tests a timeout such as `60_000`.

### `evaluateModel(model, params?, { kernel?, tolerance? })`

`model` can be an imported model module (`import * as m from "./m"`), a component, or a JSX
element. The function compiles the model, evaluates it, and fetches every part's mesh. It
never throws for modelling errors; check them with `toEvaluate()` or `r.ok`. The result
(`ModelResult`) has:

| | |
|---|---|
| `ok`, `parts`, `part(name)`, `warnings`, `values`, `document` | the evaluation |
| `volume(part?)`, `mass(part?)` | mm³; grams from `material`/`density` |
| `bbox(part?)`, `size(part?)` | bounds and `[x, y, z]` size, mm |
| `mesh(part)` | the display mesh |
| `printability(opts?, part?)`, `watertight(part?)` | `Map<part, result>` (sync) |
| `interference(opts?)` | `Promise<InterferenceResult>` (computed once) |
| `describeErrors()` | failures with their TSX locations |

### Matchers

| Matcher | Passes when |
|---|---|
| `toEvaluate()` | the model compiled and every part evaluated |
| `toHaveVolume(v, tol = 1e-3, part?)` | the volume is `v` mm³ (a `tol` < 1 is relative, ≥ 1 is in mm³) |
| `toFitIn([x, y, z])` | the bounds fit inside the box |
| `await toHaveNoInterference(minVolume?)` | no two parts share volume. It is async, so `await expect(r).toHaveNoInterference()` |
| `toBePrintable(opts)` | the overhang share of the surface is ≤ `maxOverhangFraction` (default 5 %), the thin-wall share is ≤ `maxThinFraction` (0.5 %), the part fits `bed`, and the mesh is watertight |

`toBePrintable` takes the same options as `checkPrintability` (below), plus `maxOverhangFraction`,
`maxThinFraction` and `watertight`.

### Parameter sweeps

`paramCombos(schema, options)` returns parameter sets to test with. It takes every
combination of the `boolean` and `choice` params, and for each one it samples the numeric
params (with both `min` and `max`) across their range. Values snap to `step` and ints are
rounded. Text and colours stay at their defaults.

| Option | |
|---|---|
| `method` | `"lhs"` (latin hypercube, default), `"random"`, `"corners"` (every min/max), `"grid"` |
| `samples` | numeric samples per discrete combination (or levels per number for `grid`), default 4 |
| `seed` | reproducible sampling, default 1 |
| `defaults` | include the all-defaults set first, default true |
| `max` | cap on the number of sets (sampled evenly), default 64 |
| `only`, `fixed` | vary only these params; pin some values |

`forEachParamCombo(schema, options, fn)` runs `fn(values, i)` on each set in turn and returns
how many it ran.

## Checks

```ts
import { checkPrintability, checkInterference, checkWatertight } from "tscad/check"

const mesh = await kernel.mesh("bracket")
const p = checkPrintability(mesh, { buildDir: [0, 0, 1], maxOverhangDeg: 45, minWall: 0.8, bed: [256, 256, 256] })
p.overhang.area          // mm² steeper than 45° from vertical (not counting faces on the bed)
p.overhang.faces         // grouped by B-rep face: { faceId, area, maxAngle }
p.thickness!.min         // thinnest wall found, mm
p.bed                    // { fits, rotated }
p.warnings               // human-readable problems
```

- **Overhangs.** A triangle counts as an overhang when it faces downward more steeply than
  `maxOverhangDeg` from vertical. Faces resting on the lowest plane are ignored. `severity` per
  triangle runs from 0 (fine) to 1 (a flat ceiling).
- **Wall thickness.** From each triangle's centroid, a ray is cast inward (−normal) to the
  first wall facing the other way. A bounding-volume hierarchy keeps this fast: a few ms for
  thousands of triangles. The result has `byTriangle` and `byVertex` (the minimum over the
  triangles using the vertex). It is an estimate: it measures straight through the part, so
  thin features at an angle to their normals read thicker than they are. `skipThickness: true`
  skips it.
- **Interference.** `await checkInterference(kernel, document, { minVolume })` takes every pair
  of parts whose bounding boxes overlap and evaluates the kernel `intersection` of their trees.
  Pairs sharing more than `minVolume` mm³ (default 1e-3) are reported with the volume and
  bounds of the overlap. Afterwards it re-evaluates `document` so the session's meshes are the
  model's again (`restore: false` skips that). The session's subtree cache keeps repeated
  checks cheap.
- **Watertight.** `checkWatertight(mesh)` welds vertices by position, then counts edges that
  are open, non-manifold or flipped. It also counts degenerate triangles and shells, and gives
  the Euler characteristic (2 per sphere-like shell, 0 for a torus).

### Viewer heatmaps

Everything is per triangle of the mesh you pass in, in the order of `mesh.indices`. This
matches `MeshArrays` from the kernel.

- `overhang.severity: Float32Array(triangles)`: 0 is fine, (0, 1] is how far past the limit
- `overhang.triangles: Uint32Array`: the overhanging triangles
- `thickness.byTriangle: Float32Array(triangles)` and `thickness.byVertex: Float32Array(vertices)`:
  mm, `Infinity` where no opposite wall was found
- `thickness.thinTriangles: Uint32Array`: triangles thinner than `minWall`
