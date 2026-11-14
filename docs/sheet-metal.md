# Sheet metal

`<sheetMetal>` builds a folded sheet-metal part and its **flat pattern**. You draw the base
outline once and hang flanges off its edges, nesting them as deep as you like. Bends are exact
cylindrical sections. The flat pattern unfolds each bend by its bend allowance and comes out
as drawings ready for a laser and a press brake.

```tsx
<part name="bracket" material="steel">
  <sheetMetal name="bracket" thickness={2} bendRadius={2} kFactor={0.44}>
    <flange>
      <rect w={60} h={40} />                          {/* the base outline (holes allowed) */}
      <circle d={5.5} />
      <edgeFlange edge="+y" length={50}>              {/* folds up 90° from the +y edge */}
        <circle d={5.5} x={30} y={30} />              {/* holes in the flange's own coordinates */}
        <edgeFlange edge="end" length={8} direction="down" />   {/* a return lip on its far edge */}
      </edgeFlange>
    </flange>
  </sheetMetal>
</part>
```

```sh
tscad build bracket.tsx -o bracket.step -o bracket.dxf    # folded part + flat pattern
```

## Elements

| Element | |
|---|---|
| `<sheetMetal thickness bendRadius? kFactor? name? flat?>` | The part. `bendRadius` is the inside radius (default: the thickness), `kFactor` is the neutral-axis position (default 0.44). `flat` shows the flat pattern extruded instead of the folded part. Placement props move the folded part. |
| `<flange>` | The base: a closed 2D outline (any 2D shapes, `<sketch>`, constraint sketches, `<svg>`/`<dxf>`), holes nested inside it, and the edge flanges. It lies on z = 0 with material up to z = thickness. |
| `<edgeFlange edge length angle? direction? bendRadius? inset? insetEnd? reliefs? reliefWidth? profile? corner? cornerGap? cornerRelief? cornerReliefSize?>` | Folds from `edge` by `angle` (default 90°, up to 180°) toward +Z (`direction="up"`, default) or −Z (`"down"`), with `length` of flat beyond the bend. Its 2D children are holes in its own coordinates (x along the edge from the edge's start, y away from the bend); with `profile` they are its outline instead (see below). Its `<edgeFlange>`/`<hem>`/`<jog>` children hang from its own edges. `corner*` props: see Corners. |
| `<hem edge length gap?>` | A 180° fold back over the sheet, bend radius `gap / 2` (default gap: the thickness). |
| `<jog edge offset length angle?>` | A Z-bend: up by `angle`, a web, back down. The web is sized so the jogged flange's bottom face sits `offset` above the parent's. |

**Edges.**
- On the base: `"+x" | "-x" | "+y" | "-y"`, the straight outline edge whose outward normal
  points that way (`right`, `left`, `back`/`top` and `front`/`bottom` are aliases). If several
  edges point that way, the outermost is used.
- On the base, `edge="front"` can also name a line of a constraint sketch outline by its id,
  and a number picks an outline segment by index.
- On an edge flange: `"end"` (the far edge, over the edge's own span even when corners
  extend the flange), `"left"`, `"right"`.
- On a profiled flange: outline segments by index, or constraint-sketch line ids.

**Folding.** The bend starts at the edge: the parent keeps its full outline, and the flange
comes after the bend, so dimensions are "bend outside". The inner radius `R` faces the
direction of the fold. Adjacent flanges (a tray's four walls) leave open corners by default
(see Corners). `inset` / `insetEnd` shorten a flange along its edge. In that case
rectangular bend reliefs (`reliefWidth`, default the thickness, depth R + T) are cut into the
parent at the bend's ends; `reliefs={false}` turns them off.

## Corners

Where two edge flanges hang from edges meeting at a square, convex corner of their parent
(a tray's walls), `corner` on either decides how they meet:

| `corner` | Folded | Flat pattern |
|---|---|---|
| `"open"` (default) | a gap of R + T each way | nothing added |
| `"closed"` | both run on and meet on the corner's diagonal, mitred, `cornerGap` apart | each end extended to the inside of the mitre, R − gap/√2 (a laser cuts square) |
| `"overlap"` | this flange runs on by R + T, flush with the neighbour's outside; the neighbour runs on R − `cornerGap` | the same extensions |

`cornerGap` defaults to min(0.2, T / 4). Both flanges must be 90°, fold the same way, have the
same radius and not be profiled. Otherwise the corner stays open, with a warning if a corner
was asked for.

`cornerRelief` cuts a relief where the two bends meet:
- `"rect"`: a square of side `cornerReliefSize` (default R + T) cut into the parent at the
  corner.
- `"round"`: a disc of that radius cut into the parent at the corner.
- `"tear"`: nothing cut.
With `"rect"` and `"round"`, both bends stop `cornerReliefSize` short of the corner. The
flanges themselves keep their full length.

## Profiled flanges

With `profile`, an edge flange's 2D children are its outline: a tapered tab, a trapezoid, a
flange with a notch, plus holes inside it. They are drawn in the flange's coordinates, and the
outline must stand on the bend line: a straight edge along y = 0 from x = 0 to the flange's
width, with nothing below it. `length` is optional (the outline's height).

```tsx
<edgeFlange edge="end" direction="down" inset={10} profile>
  <polygon points={[[0, 0], [90, 0], [78, 12], [12, 12]]} />
  <circle d={4} x={45} y={6} />
</edgeFlange>
```

## The flat pattern

Every bend is unfolded into a strip of width BA = θ·(R + K·T), its bend allowance. The flat
pattern is the union of every flange's outline (holes and reliefs cut) and the bend strips,
in the base's coordinates. It comes out in `CompileResult.drawings`:

| Drawing | Layer | Content |
|---|---|---|
| `<name>-flat` | `cut` | the outline and holes (exact lines and arcs) |
| `<name>-bends` | `bend` | each bend's centre line, an open path (`Drawing.paths`), plus a text note per bend, `UP 90° R2` / `DN 45° R2`, beside it (`Drawing.notes`) |
| `<name>-notes` | `engrave` | the same labels as text outlines, for lasers that mark parts |

`tscad build -o part.dxf` (or `.svg`) writes them on those layers:
- DXF: bend lines as LINE (or an open POLYLINE with `entities: "polyline"`), notes as TEXT
  centred beside the line (`°` as `%%d`).
- SVG: bend lines as a `<path>` without `Z`, notes as `<text>`.

**Checks** (`tests/sheet.test.tsx`):
- flat length a + BA + b for an L bracket;
- a U channel;
- a four-wall tray's cross-shaped flat;
- insets with reliefs, holes and a hem;
- a jog's offset;
- edges named by sketch line ids;
- closed (mitred), overlapped and relieved tray corners;
- a profiled tab;
- the DXF's layers, open bend entities and TEXT notes, in both entity styles;
- folded volume = flat panels × T + Σ θ·w·T·(R + T/2) (Pappus), and = flat area × T when K = 0.5.

## Examples

- `examples/sheet-l-bracket.tsx`: slotted base, a hole row up the flange, a return lip.
- `examples/sheet-chassis.tsx`: an electronics tray with vents, standoff holes, four walls with
  closed corners (or overlap / open, a parameter) and round corner reliefs, a connector
  cut-out, and tapered mounting tabs (profiled, inset with reliefs) folded out along the side
  walls.

## Limits

- A profiled flange's bend is as wide as its edge minus insets. Its outline stands on that
  whole width.
- Edges must be straight segments of the outline.
- Corners close only between two 90° edge flanges on a square convex corner. A closed
  corner's mitre is exact in the folded model. The flat pattern cuts square at the mitre's
  inside, so the corner gets welded or ground after folding.
