# Example param sweep

Every example is evaluated across its parameter space, not just at its defaults: the defaults,
a seeded latin hypercube over the numeric params (for every combination of the choice and
boolean params), and the min/max corners, about 33 combos each, from
[`paramCombos`](checks.md). Each combo is compiled and evaluated with the kernel (native when
built), and every failure is classified:

- **model**: the params produce geometry the model should never ask for (a hole bigger than
  its plate, a fillet bigger than a wall). Fixed in the example by deriving or clamping values.
- **kernel**: valid input the kernel rejects. Minimal repro in
  [`fuzz/sweep-regressions.json`](../fuzz/sweep-regressions.json) and an entry in
  [KERNEL_ISSUES](KERNEL_ISSUES.md).
- **slow**: a combo with no result after 60 s (`hang` in the tool's output).

```sh
bun scripts/sweep-examples.ts                      # every example (~11 min on 16 cores)
bun scripts/sweep-examples.ts bracket cookbook/name-tag --json out.json --md out.md
TSCAD_SWEEP=1 bun test tests/sweep.examples.test.ts  # the same, as a test
```

The test fails on any model failure, and on kernel failures in examples that aren't listed
with their KERNEL_ISSUES entry; it also fails when a listed example starts passing, so the list
stays honest.

## Results (2026-11-14)

1221 of 1359 combos passed before the fixes; 1394 of 1458 after (three new examples joined
the sweep). Only examples with a failure, a fix or a slow combo are listed; the other 19 pass
every combo.

| example | before | after | slowest | remaining |
| --- | --- | --- | --- | --- |
| agent/d-shaft-knob | 31/33 | 33/33 | 11.2 s |  |
| agent/drawer-organiser | 34/34 | 34/34 | 23.8 s |  |
| agent/pi5-case | 24/33 | 33/33 | 4.4 s |  |
| bolt-and-nut | 36/36 | 35/36 | 60.5 s | slow: M3 × 120 thread > 60 s |
| bracket | 29/33 | 33/33 | 9.4 s |  |
| cable-clip | 32/33 | 33/33 | 3.4 s |  |
| coaster | 31/33 | 30/33 | 60.8 s | slow: ~500 cells at Ø160 / cell 5 take > 60 s |
| converted/box-with-lid | 32/33 | 33/33 | 0.2 s |  |
| converted/enclosure | 24/33 | 33/33 | 2.0 s |  |
| converted/grid-bin | 30/32 | 25/32 | 60.8 s | kernel #21 at 1 × 1; slow (> 60 s) at 5-6 units a side |
| cookbook/gear-pair | 19/33 | 20/33 | 9.0 s | kernel #17 |
| cookbook/name-tag | 30/33 | 30/33 | 3.1 s | kernel #19 (glyph "t" at 1–3 mm) |
| cookbook/pegboard-bin | 33/33 | 33/33 | 28.5 s |  |
| enclosure | 26/33 | 27/33 | 10.6 s | kernel #14 (PointClassify) at large corner radii with thin walls |
| laser-box | 33/33 | 33/33 | 30.4 s |  |
| sheet-chassis | new | 33/33 | 10.4 s |  |
| sheet-l-bracket | new | 33/33 | 5.9 s |  |
| sketch-coat-hook | 25/33 | 33/33 | 3.2 s |  |
| sketch-flange | 20/33 | 33/33 | 14.1 s |  |
| sketch-link-arm | 25/33 | 32/33 | 4.3 s | kernel #20 |
| sketch-on-face | new | 30/33 | 6.6 s | model: the boss face selector matches nothing when the boss outgrows the block (with the sketch agent) |
| sketch-pulley | 28/33 | 33/33 | 0.6 s |  |
| sketch-vase | 15/33 | 33/33 | 11.3 s |  |
| spur-gear | 7/33 | 7/33 | 60.8 s | kernel #17 (gear root gaps), #18 (chamfer limit); slow at many teeth with the tooth chamfer |
| vase | 27/33 | 32/33 | 8.8 s | kernel #18 (shell, extreme radius swings) |

### What the fixes were

- **bracket**: the inside-bend fillet is at most a third of each leg, the corner radius fits
  the width and the flat of each leg, holes start past the bend and rows/columns that would
  overlap (pitch < 1.5 Ø) are dropped, and the slots stay clear of the bend.
- **agent/pi5-case**: `vents = 0` leaves the vents out instead of asking for a zero-count
  pattern.
- **cable-clip**: the snap opening is capped where the bore meets the opening's floor, so no
  sliver too thin to round is left.
- **agent/d-shaft-knob**: at most one flute per 2.8 mm of rim, so neighbouring flutes leave a
  land (overlapping flutes left 0.008 mm arcs, which hit kernel #18).
- **cookbook/name-tag**: the hole, corner radius and text are sized from the short side; tall
  narrow tags gave a negative text size.
- **vase**: the Catmull-Rom control points stay off the axis, and the wall is capped by the
  narrowest radius and the outline's tightest bend.
- **spur-gear**: the tooth chamfer is capped by the outline's tightest bend (`chamferLimit`).
- **enclosure**: the bottom round is no bigger than the corner radius.
- The sketch agent's examples (sketch-*, converted/*) derive their clearances, bores and
  counts from the params, and converted/enclosure and box-with-lid tightened their `.scad`
  ranges; sketch-vase hollows with an inset loft instead of `<shell>` (kernel #22).

## Failures after the fixes

### bolt-and-nut

- **hang**: no result after 60 s, params `{"size":"M3","length":120,"grooves":true,"gap":60}`

### coaster

- **hang**: no result after 60 s, params `{"diameter":158,"thickness":13,"cell":5.5,"web":1.6,"depth":8.1,"rim":10}`
- **hang**: no result after 60 s, params `{"diameter":160,"thickness":3,"cell":5,"web":0.8,"depth":0.5,"rim":2}`
- **hang**: no result after 60 s, params `{"diameter":160,"thickness":15,"cell":5,"web":0.8,"depth":0.5,"rim":2}`

### converted/grid-bin

- **hang**: no result after 60 s, params `{"units_x":6,"units_y":5,"height_u":1}`
- **hang**: no result after 60 s, params `{"units_x":6,"units_y":5,"height_u":6}`
- **hang**: no result after 60 s, params `{"units_x":5,"units_y":6,"height_u":2}`
- **hang**: no result after 60 s, params `{"units_x":5,"units_y":6,"height_u":9}`
- **kernel** (part): union: the result is not a closed solid, params `{"units_x":1,"units_y":1,"height_u":1}`
- **hang**: no result after 60 s, params `{"units_x":6,"units_y":6,"height_u":1}`
- **hang**: no result after 60 s, params `{"units_x":6,"units_y":6,"height_u":10}`

### cookbook/gear-pair

- **kernel** (driven): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"driveTeeth":39,"drivenTeeth":51,"module":1,"turn":72}`
- **kernel** (driven): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"driveTeeth":28,"drivenTeeth":47,"module":2.5,"turn":173}`
- **kernel** (driven): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"driveTeeth":24,"drivenTeeth":58,"module":2.75,"turn":229}`
- **kernel** (driven): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"driveTeeth":37,"drivenTeeth":48,"module":2.5,"turn":324}`
- **kernel** (driven): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"driveTeeth":34,"drivenTeeth":57,"module":1.25,"turn":163}`
- **kernel** (driven): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"driveTeeth":15,"drivenTeeth":52,"module":3,"turn":205}`
- **kernel** (driven): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"driveTeeth":33,"drivenTeeth":56,"module":3.5,"turn":140}`
- **kernel** (driven): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"driveTeeth":27,"drivenTeeth":43,"module":1.75,"turn":107}`
- … 5 more

### cookbook/name-tag

- **kernel** (tag-3d): extrude: the result is not a closed solid, params `{"name":"tscad","width":34,"height":56,"thickness":2.5}`
- **kernel** (tag-3d): extrude: the result is not a closed solid, params `{"name":"tscad","width":30,"height":80,"thickness":1}`
- **kernel** (tag-3d): extrude: the result is not a closed solid, params `{"name":"tscad","width":30,"height":80,"thickness":6}`

### enclosure

- **kernel** (lid): fillet: too large: the largest Radius that fits is 1.499999999999948, params `{"width":57,"depth":82,"height":33,"wall":4.5,"radius":1.5,"vents":7,"usb":false,"exploded":false}`
- **kernel** (body): difference: not supported yet: SmFace::PointClassify, params `{"width":67,"depth":100,"height":88,"wall":1.5,"radius":5.5,"vents":10,"usb":false,"exploded":false}`
- **kernel** (body): difference: not supported yet: SmFace::PointClassify, params `{"width":80,"depth":60,"height":93,"wall":1.6,"radius":11,"vents":2,"usb":false,"exploded":true}`
- **kernel** (lid): fillet: too large: the largest Radius that fits is 1.4999999999998979, params `{"width":179,"depth":90,"height":64,"wall":4,"radius":1.5,"vents":11,"usb":true,"exploded":false}`
- **kernel** (body): difference: not supported yet: SmFace::PointClassify, params `{"width":155,"depth":52,"height":32,"wall":1.4,"radius":9.5,"vents":7,"usb":true,"exploded":false}`
- **kernel** (body): difference: not supported yet: SmFace::PointClassify, params `{"width":66,"depth":152,"height":13,"wall":1.9,"radius":14.5,"vents":4,"usb":true,"exploded":true}`

### sketch-link-arm

- **kernel** (link-arm): fillet: no room, params `{"length":54,"bigRadius":28,"smallRadius":12.5,"bigBore":9,"smallBore":37,"slotWidth":14,"thickness":17,"edgeRound":2.5}`

### sketch-on-face

- **kernel** (bearing-block): onFace: the face selector matched 0 faces (index 0), params `{"width":58,"depth":45,"thickness":18,"boss":53,"bossHeight":5,"bearing":16,"bearingWidth":11.5,"bore":29.5,"holeSpacing":78}`
- **kernel** (bearing-block): onFace: the face selector matched 0 faces (index 0), params `{"width":85,"depth":39,"thickness":8.5,"boss":58,"bossHeight":28.5,"bearing":30.5,"bearingWidth":3.5,"bore":28,"holeSpacing":43}`
- **kernel** (bearing-block): onFace: the face selector matched 0 faces (index 0), params `{"width":62,"depth":38,"thickness":19.5,"boss":51,"bossHeight":17.5,"bearing":43.5,"bearingWidth":13,"bore":10,"holeSpacing":62}`

### spur-gear

- **kernel** (gear): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"teeth":69,"module":3,"pressureAngle":19.5,"thickness":16,"bore":13,"hub":false,"lightening":false,"toothChamfer":false}`
- **kernel** (gear): chamfer: no room, params `{"teeth":27,"module":1.75,"pressureAngle":19,"thickness":6,"bore":3,"hub":false,"lightening":false,"toothChamfer":true}`
- **kernel** (gear): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"teeth":61,"module":4.5,"pressureAngle":24,"thickness":13.5,"bore":21,"hub":false,"lightening":false,"toothChamfer":true}`
- **hang**: no result after 60 s, params `{"teeth":39,"module":2.25,"pressureAngle":18,"thickness":22,"bore":14,"hub":false,"lightening":false,"toothChamfer":true}`
- **kernel** (gear): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"teeth":73,"module":1.5,"pressureAngle":22,"thickness":4.5,"bore":29.5,"hub":false,"lightening":true,"toothChamfer":false}`
- **kernel** (gear): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"teeth":56,"module":5,"pressureAngle":17.5,"thickness":25.5,"bore":3.5,"hub":false,"lightening":true,"toothChamfer":false}`
- **kernel** (gear): extrude: the result is not a closed solid (planar extrude: the result is not a closed solid), params `{"teeth":59,"module":4.25,"pressureAngle":22,"thickness":27,"bore":21.5,"hub":false,"lightening":true,"toothChamfer":true}`
- **kernel** (gear): chamfer: too large: the largest Distance that fits is 0.09493615448912804, params `{"teeth":41,"module":1.5,"pressureAngle":17.5,"thickness":12.5,"bore":3,"hub":false,"lightening":true,"toothChamfer":true}`
- … 18 more

### vase

- **kernel** (vase): shell: mass::enclosure: a face whose sides are not one material region and one void, params `{"height":45,"base":45,"belly":74,"neck":70,"lip":10,"wall":4.3,"color":"porcelain"}`