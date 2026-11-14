# Selectors

Fillets, chamfers and shells act on **edges** or **faces** that you pick with a selector. A
selector is a filter over the finished body: "the edges at the top", "the vertical edges", "the
circles of radius 3". Because it describes geometry rather than naming an edge, it survives
parameter changes.

```tsx
import { edges, faces } from "tscad"

<fillet radius={2} edges={edges.vertical()}>…</fillet>
<chamfer distance={1} edges=">Z">…</chamfer>
<shell thickness={2} open={faces.top()}>…</shell>
```

Every `edges=` / `open=` prop accepts a **string**, a **builder** (`edges.…` / `faces.…`) or a raw
IR selector object. Leave `edges` out to take every edge.

## Cheatsheet

| Picks | String | Builder |
|---|---|---|
| everything | `"*"` | `edges.all()` |
| nothing | `"none"` | `faces.none()` |
| at the top (max Z) | `">Z"` | `edges.top()` · `edges.max("z")` |
| at the bottom (min Z) | `"<Z"` | `edges.bottom()` · `edges.min("z")` |
| at max / min X, Y | `">X"` `"<Y"` | `edges.max("x")` `edges.min("y")` |
| straight edges along Z | `"\|Z"` | `edges.vertical()` · `edges.parallel("z")` |
| straight edges along X | `"\|X"` | `edges.parallel("x")` |
| circles about Z | `"#Z"` | `edges.circles()` · `edges.circles("z")` |
| circles of radius r | — | `edges.radius(3)` |
| inside a box | — | `edges.within([x0, y0, z0], [x1, y1, z1])` |
| by record index | — | `edges.index(4, 7)` |
| both | `">Z and \|X"` | `edges.top().and(edges.parallel("x"))` · `edges.top().parallel("x")` |
| either | `">Z or \|Z"` | `edges.top().or(edges.vertical())` |
| not | `"not <Z"` | `edges.bottom().not()` |

Strings are case-insensitive; `not` binds tighter than `and`, which binds tighter than `or`;
use parentheses to group: `"(>Z or <Z) and #Z"`. Chaining builder filters ANDs them:
`edges.top().circles()` is "circles at the top".

## What they mean

| Selector | On edges | On faces |
|---|---|---|
| `max` / `min` axis | edges lying wholly at the body's extreme along the axis | faces lying wholly there |
| `parallel` axis | straight edges along the axis | planar faces whose normal is ±axis |
| `perpendicular` axis | circles about the axis | planar faces whose normal is square to the axis |
| `radius` r | circles of radius r | — |
| `within` box | edges whose sample points are all inside | faces likewise |

Things to know:

- `">Z"` on a plate with a through-hole picks the hole's top circle as well as the outer top
  edges — they are all at max Z. Use `">Z and not #Z"` for just the outline, or
  `">Z and #Z"` for just the hole.
- Broad selectors skip seam edges and smooth (tangent) joins automatically, so `edges.all()`
  on a rounded shape works.
- A selector that matches nothing is an error that points at the `<fillet>`'s line.

## Finding a selector

- In `tscad dev` and the playground, **click an edge or face**: the panel lists selectors that
  pick it, most specific first, with how many edges each one matches. Click to copy.
- From an agent, the `tscad_pick_selectors` MCP tool does the same from a point in space.
