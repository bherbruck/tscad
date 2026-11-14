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
| `<edgeFlange edge length angle? direction? bendRadius? inset? insetEnd? reliefs? reliefWidth?>` | Folds from `edge` by `angle` (default 90°, up to 180°) toward +Z (`direction="up"`, default) or −Z (`"down"`), with `length` of flat beyond the bend. Its 2D children are holes in its own coordinates (x along the edge from the edge's start, y away from the bend). Its `<edgeFlange>`/`<hem>`/`<jog>` children hang from its own edges. |
| `<hem edge length gap?>` | A 180° fold back over the sheet, bend radius `gap / 2` (default gap: the thickness). |
| `<jog edge offset length angle?>` | A Z-bend: up by `angle`, a web, back down. The web is sized so the jogged flange's bottom face sits `offset` above the parent's. |

**Edges.**
- On the base: `"+x" | "-x" | "+y" | "-y"`, the straight outline edge whose outward normal
  points that way (`right`, `left`, `back`/`top` and `front`/`bottom` are aliases). If several
  edges point that way, the outermost is used.
- On the base, `edge="front"` can also name a line of a constraint sketch outline by its id,
  and a number picks an outline segment by index.
- On an edge flange: `"end"` (the far edge), `"left"`, `"right"`.

**Folding.** The bend starts at the edge: the parent keeps its full outline, and the flange
comes after the bend, so dimensions are "bend outside". The inner radius `R` faces the
direction of the fold. Adjacent flanges (a tray's four walls) leave open corners, which are the
usual corner reliefs. `inset` / `insetEnd` shorten a flange along its edge. In that case
rectangular bend reliefs (`reliefWidth`, default the thickness, depth R + T) are cut into the
parent at the bend's ends; `reliefs={false}` turns them off.

## The flat pattern

Every bend is unfolded into a strip of width BA = θ·(R + K·T), its bend allowance. The flat
pattern is the union of every flange's outline (holes and reliefs cut) and the bend strips,
in the base's coordinates. It comes out in `CompileResult.drawings`:

| Drawing | Layer | Content |
|---|---|---|
| `<name>-flat` | `cut` | the outline and holes (exact lines and arcs) |
| `<name>-bends` | `bend` | each bend's centre line, as one open line |
| `<name>-notes` | `engrave` | a label per bend, `UP 90° R2` / `DN 45° R2`, beside the line (text outlines) |

`tscad build -o part.dxf` (or `.svg`) writes them on those layers.

**Checks** (`tests/sheet.test.tsx`):
- flat length a + BA + b for an L bracket;
- a U channel;
- a four-wall tray's cross-shaped flat;
- insets with reliefs, holes and a hem;
- a jog's offset;
- edges named by sketch line ids;
- folded volume = flat panels × T + Σ θ·w·T·(R + T/2) (Pappus), and = flat area × T when K = 0.5.

## Examples

- `examples/sheet-l-bracket.tsx`: slotted base, a hole row up the flange, a return lip.
- `examples/sheet-chassis.tsx`: an electronics tray with vents, standoff holes, four walls, a
  connector cut-out, and inset mounting tabs (with reliefs) folded out along the side walls.

## Limits

- Edge flanges are rectangular, as wide as their edge minus insets. For a shaped flange, make
  it its own base `<flange>` in another `<sheetMetal>`.
- Edges must be straight segments of the outline.
- No closed corners or mitres: walls meeting at a corner leave the open relief.
- Bend lines are written as open single-segment entities.
