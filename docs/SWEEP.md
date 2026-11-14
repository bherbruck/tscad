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

1221 of 1359 combos passed before the fixes; 1339 of 1458 after (three new examples joined
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
| converted/box-with-lid | 32/33 | 32/33 | 0.2 s | with the sketch agent |
| converted/enclosure | 24/33 | 24/33 | 2.0 s | with the sketch agent (corner_r = 0) |
| converted/grid-bin | 30/32 | 24/32 | 60.9 s | slow (> 60 s at 6 × 6 units) and union failures — with the sketch agent |
| cookbook/gear-pair | 19/33 | 19/33 | 9.0 s | kernel #17 |
| cookbook/name-tag | 30/33 | 30/33 | 3.1 s | kernel #19 (glyph "t" at 1–3 mm) |
| cookbook/pegboard-bin | 33/33 | 33/33 | 28.5 s |  |
| enclosure | 26/33 | 27/33 | 10.6 s | kernel #14 (PointClassify) at large corner radii with thin walls |
| laser-box | 33/33 | 33/33 | 30.4 s |  |
| sheet-chassis | — | 33/33 | 10.4 s |  |
| sheet-l-bracket | — | 33/33 | 5.9 s |  |
| sketch-coat-hook | 25/33 | 33/33 | 3.2 s |  |
| sketch-flange | 20/33 | 15/33 | 14.1 s | with the sketch agent |
| sketch-link-arm | 25/33 | 25/33 | 4.3 s | with the sketch agent |
| sketch-on-face | — | 30/33 | 6.6 s | with the sketch agent |
| sketch-pulley | 28/33 | 33/33 | 0.6 s |  |
| sketch-vase | 15/33 | 15/33 | 11.3 s | with the sketch agent |
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

## Failures after the fixes

### bolt-and-nut

- **hang**: no result after 60 s — `{"size":"M3","length":120,"grooves":true,"gap":60}`

### coaster

- **hang**: no result after 60 s — `{"diameter":158,"thickness":13,"cell":5.5,"web":1.6,"depth":8.1,"rim":10}`
- **hang**: no result after 60 s — `{"diameter":160,"thickness":3,"cell":5,"web":0.8,"depth":0.5,"rim":2}`
- **hang**: no result after 60 s — `{"diameter":160,"thickness":15,"cell":5,"web":0.8,"depth":0.5,"rim":2}`

### converted/box-with-lid

- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/box-with-lid.tsx:37:11: <box> height must be greater than 0 (got -0.5999999999999996) — `{"width":24,"depth":80,"height":89,"wall":4.6,"part":"lid","lid_height":4}`

### converted/enclosure

- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/enclosure.tsx:25:108: <circle> r must be greater than 0 (got 0) — `{"inner_x":39,"inner_y":20,"inner_z":48,"wall":1.2,"floor_t":2.2,"corner_r":0,"post_d":10.5,"screw_d":4.6,"post_inset":13}`
- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/enclosure.tsx:25:108: <circle> r must be greater than 0 (got 0) — `{"inner_x":20,"inner_y":20,"inner_z":10,"wall":1,"floor_t":1,"corner_r":0,"post_d":4,"screw_d":1.5,"post_inset":3}`
- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/enclosure.tsx:25:108: <circle> r must be greater than 0 (got 0) — `{"inner_x":20,"inner_y":20,"inner_z":100,"wall":1,"floor_t":1,"corner_r":0,"post_d":4,"screw_d":1.5,"post_inset":3}`
- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/enclosure.tsx:25:108: <circle> r must be greater than 0 (got 0) — `{"inner_x":20,"inner_y":200,"inner_z":10,"wall":1,"floor_t":1,"corner_r":0,"post_d":4,"screw_d":1.5,"post_inset":3}`
- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/enclosure.tsx:25:108: <circle> r must be greater than 0 (got 0) — `{"inner_x":20,"inner_y":200,"inner_z":100,"wall":1,"floor_t":1,"corner_r":0,"post_d":4,"screw_d":1.5,"post_inset":3}`
- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/enclosure.tsx:25:108: <circle> r must be greater than 0 (got 0) — `{"inner_x":200,"inner_y":20,"inner_z":10,"wall":1,"floor_t":1,"corner_r":0,"post_d":4,"screw_d":1.5,"post_inset":3}`
- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/enclosure.tsx:25:108: <circle> r must be greater than 0 (got 0) — `{"inner_x":200,"inner_y":20,"inner_z":100,"wall":1,"floor_t":1,"corner_r":0,"post_d":4,"screw_d":1.5,"post_inset":3}`
- **compile**: /home/bherbruck/tlabs/tscad/examples/converted/enclosure.tsx:25:108: <circle> r must be greater than 0 (got 0) — `{"inner_x":200,"inner_y":200,"inner_z":10,"wall":1,"floor_t":1,"corner_r":0,"post_d":4,"screw_d":1.5,"post_inset":3}`
- … 1 more

### converted/grid-bin

- **hang**: no result after 60 s — `{"units_x":6,"units_y":5,"height_u":1}`
- **hang**: no result after 60 s — `{"units_x":4,"units_y":5,"height_u":5}`
- **hang**: no result after 60 s — `{"units_x":6,"units_y":5,"height_u":6}`
- **hang**: no result after 60 s — `{"units_x":5,"units_y":6,"height_u":2}`
- **hang**: no result after 60 s — `{"units_x":5,"units_y":6,"height_u":9}`
- **kernel** (part): union: the result is not a closed solid — `{"units_x":1,"units_y":1,"height_u":1}`
- **hang**: no result after 60 s — `{"units_x":6,"units_y":6,"height_u":1}`
- **hang**: no result after 60 s — `{"units_x":6,"units_y":6,"height_u":10}`

### cookbook/gear-pair

- **kernel** (driven): extrude: the result is not a closed solid — `{"driveTeeth":39,"drivenTeeth":51,"module":1,"turn":72}`
- **kernel** (driven): extrude: the result is not a closed solid — `{"driveTeeth":21,"drivenTeeth":40,"module":3.75,"turn":340}`
- **kernel** (driven): extrude: the result is not a closed solid — `{"driveTeeth":28,"drivenTeeth":47,"module":2.5,"turn":173}`
- **kernel** (driven): extrude: the result is not a closed solid — `{"driveTeeth":24,"drivenTeeth":58,"module":2.75,"turn":229}`
- **kernel** (driven): extrude: the result is not a closed solid — `{"driveTeeth":37,"drivenTeeth":48,"module":2.5,"turn":324}`
- **kernel** (driven): extrude: the result is not a closed solid — `{"driveTeeth":34,"drivenTeeth":57,"module":1.25,"turn":163}`
- **kernel** (driven): extrude: the result is not a closed solid — `{"driveTeeth":15,"drivenTeeth":52,"module":3,"turn":205}`
- **kernel** (driven): extrude: the result is not a closed solid — `{"driveTeeth":33,"drivenTeeth":56,"module":3.5,"turn":140}`
- … 6 more

### cookbook/name-tag

- **kernel** (tag-3d): extrude: the result is not a closed solid — `{"name":"tscad","width":34,"height":56,"thickness":2.5}`
- **kernel** (tag-3d): extrude: the result is not a closed solid — `{"name":"tscad","width":30,"height":80,"thickness":1}`
- **kernel** (tag-3d): extrude: the result is not a closed solid — `{"name":"tscad","width":30,"height":80,"thickness":6}`

### enclosure

- **kernel** (lid): fillet: too large: the largest Radius that fits is 1.499999999999948 — `{"width":57,"depth":82,"height":33,"wall":4.5,"radius":1.5,"vents":7,"usb":false,"exploded":false}`
- **kernel** (body): difference: not supported yet: SmFace::PointClassify — `{"width":67,"depth":100,"height":88,"wall":1.5,"radius":5.5,"vents":10,"usb":false,"exploded":false}`
- **kernel** (body): difference: not supported yet: SmFace::PointClassify — `{"width":80,"depth":60,"height":93,"wall":1.6,"radius":11,"vents":2,"usb":false,"exploded":true}`
- **kernel** (lid): fillet: too large: the largest Radius that fits is 1.4999999999998979 — `{"width":179,"depth":90,"height":64,"wall":4,"radius":1.5,"vents":11,"usb":true,"exploded":false}`
- **kernel** (body): difference: not supported yet: SmFace::PointClassify — `{"width":155,"depth":52,"height":32,"wall":1.4,"radius":9.5,"vents":7,"usb":true,"exploded":false}`
- **kernel** (body): difference: not supported yet: SmFace::PointClassify — `{"width":66,"depth":152,"height":13,"wall":1.9,"radius":14.5,"vents":4,"usb":true,"exploded":true}`

### sketch-flange

- **kernel** (flange): fillet: the rounds leave a face whose boundary crosses itself at [[-44.6003082948986, 25.749999999999964, 10.5], [-9.4603965234133e-15, -51.499999999999986, 10.5], [44.600308294898596, 25.749999999999982, 10.500000000000002]] (largest None) — `{"diameter":196,"bore":101,"bolts":3,"boltCircle":56,"boltHole":16.4,"lugReach":102,"lugRadius":12.5,"lugHole":6.2,"thickness":10.5}`
- **kernel** (flange): fillet: the rounds leave a face whose boundary crosses itself at [[-9.446895146241998, -35.256292659550994, 17.0], [9.446895146242, -35.256292659550994, 17.000000000000004], [-9.446895146242008, 35.25629265955097, 17.000000000000004], [9.44 — `{"diameter":75,"bore":33,"bolts":12,"boltCircle":156,"boltHole":4,"lugReach":53,"lugRadius":18,"lugHole":19.6,"thickness":17}`
- **kernel** (flange): fillet: the rounds leave a face whose boundary crosses itself at [[-9.297174375767185, 31.66326812927841, 6.000000000000001], [-24.93973595369054, 21.610404220194393, 6.000000000000001], [-32.664107582070784, 4.696389663018415, 6.0000000000 — `{"diameter":154,"bore":64,"bolts":11,"boltCircle":38,"boltHole":10.2,"lugReach":78,"lugRadius":11,"lugHole":8.6,"thickness":6}`
- **kernel** (flange): fillet: solidcore failed (status 1001) — `{"diameter":91,"bore":73,"bolts":6,"boltCircle":146,"boltHole":17.2,"lugReach":87,"lugRadius":9,"lugHole":5,"thickness":20}`
- **kernel** (flange): fillet: the rounds leave a face whose boundary crosses itself at [[-6.348105219637832e-15, -52.50000000000001, 7.999999999999998], [-10.91536376793236, 51.35274903852478, 7.999999999999998], [10.91536376793232, 51.352749038524784, 7.9999999 — `{"diameter":107,"bore":78,"bolts":15,"boltCircle":171,"boltHole":12.8,"lugReach":139,"lugRadius":14,"lugHole":11.6,"thickness":8}`
- **kernel** (flange): fillet: the result is not a closed solid — `{"diameter":150,"bore":17,"bolts":13,"boltCircle":60,"boltHole":15,"lugReach":125,"lugRadius":21.5,"lugHole":4.2,"thickness":12.5}`
- **kernel** (flange): fillet: the rounds leave a face whose boundary crosses itself at [[-16.074946736306426, 44.1655531769377, 14.999999999999998], [-40.70319397786862, 23.500000000000007, 14.999999999999996], [-46.285964391573785, -8.161464350345717, 14.999999 — `{"diameter":141,"bore":92,"bolts":9,"boltCircle":99,"boltHole":9.5,"lugReach":37,"lugRadius":24.5,"lugHole":15.3,"thickness":15}`
- **kernel** (flange): fillet: solidcore failed (status 1001) — `{"diameter":96,"bore":50,"bolts":8,"boltCircle":132,"boltHole":16,"lugReach":60,"lugRadius":9,"lugHole":13.4,"thickness":5}`
- … 10 more

### sketch-link-arm

- **kernel** (link-arm): fillet: no room — `{"length":196,"bigRadius":34.5,"smallRadius":5.5,"bigBore":12.5,"smallBore":32.5,"slotWidth":13,"thickness":7,"edgeRound":0.5}`
- **kernel** (link-arm): fillet: the result is not a closed solid — `{"length":177,"bigRadius":25,"smallRadius":8,"bigBore":38,"smallBore":26.5,"slotWidth":14,"thickness":14.5,"edgeRound":1.25}`
- **kernel** (link-arm): fillet: no room — `{"length":54,"bigRadius":28,"smallRadius":12.5,"bigBore":9,"smallBore":37,"slotWidth":14,"thickness":17,"edgeRound":2.5}`
- **kernel** (link-arm): fillet: solidcore failed (status 1001) — `{"length":103,"bigRadius":19.5,"smallRadius":15,"bigBore":35.5,"smallBore":31.5,"slotWidth":6.5,"thickness":4.5,"edgeRound":1.75}`
- **kernel** (link-arm): fillet: solidcore failed (status 1001) — `{"length":66,"bigRadius":8,"smallRadius":15.5,"bigBore":5.5,"smallBore":13.5,"slotWidth":2.5,"thickness":17,"edgeRound":2.75}`
- **kernel** (link-arm): fillet: the result is not a closed solid — `{"length":122,"bigRadius":15.5,"smallRadius":14,"bigBore":31,"smallBore":39.5,"slotWidth":4.5,"thickness":3,"edgeRound":2.5}`
- **kernel** (link-arm): fillet: the result is not a closed solid — `{"length":134,"bigRadius":12.5,"smallRadius":9.5,"bigBore":48,"smallBore":38,"slotWidth":11.5,"thickness":3.5,"edgeRound":2.75}`
- **kernel** (link-arm): fillet: no room — `{"length":91,"bigRadius":12,"smallRadius":23,"bigBore":40.5,"smallBore":23,"slotWidth":17,"thickness":13,"edgeRound":0.75}`

### sketch-on-face

- **kernel** (bearing-block): onFace: the face selector matched 0 faces (index 0) — `{"width":58,"depth":45,"thickness":18,"boss":53,"bossHeight":5,"bearing":16,"bearingWidth":11.5,"bore":29.5,"holeSpacing":78}`
- **kernel** (bearing-block): onFace: the face selector matched 0 faces (index 0) — `{"width":85,"depth":39,"thickness":8.5,"boss":58,"bossHeight":28.5,"bearing":30.5,"bearingWidth":3.5,"bore":28,"holeSpacing":43}`
- **kernel** (bearing-block): onFace: the face selector matched 0 faces (index 0) — `{"width":62,"depth":38,"thickness":19.5,"boss":51,"bossHeight":17.5,"bearing":43.5,"bearingWidth":13,"bore":10,"holeSpacing":62}`

### sketch-vase

- **kernel** (vase): shell: the result is not a closed solid — `{"height":102,"foot":49,"belly":119,"neck":87,"roundness":0.1,"wall":2}`
- **kernel** (vase): shell: the result is not a closed solid — `{"height":195,"foot":74,"belly":110,"neck":27,"roundness":0.26,"wall":3}`
- **kernel** (vase): shell: the result is not a closed solid — `{"height":68,"foot":71,"belly":154,"neck":61,"roundness":0.18,"wall":2.1}`
- **kernel** (vase): shell: the result is not a closed solid — `{"height":80,"foot":30,"belly":91,"neck":24,"roundness":0.19,"wall":1.1}`
- **kernel** (vase): shell: the result is not a closed solid — `{"height":156,"foot":117,"belly":115,"neck":71,"roundness":0.2,"wall":4.9}`
- **kernel** (vase): shell: the wall folds (largest Some(1.8659120658482804)) — `{"height":92,"foot":54,"belly":155,"neck":21,"roundness":0.05,"wall":6}`
- **kernel** (vase): shell: the result is not a closed solid — `{"height":99,"foot":107,"belly":120,"neck":66,"roundness":0.13,"wall":4.7}`
- **kernel** (vase): shell: the result is not a closed solid — `{"height":112,"foot":41,"belly":126,"neck":84,"roundness":0.3,"wall":5.2}`
- … 10 more

### spur-gear

- **kernel** (gear): extrude: the result is not a closed solid — `{"teeth":69,"module":3,"pressureAngle":19.5,"thickness":16,"bore":13,"hub":false,"lightening":false,"toothChamfer":false}`
- **kernel** (gear): chamfer: no room — `{"teeth":27,"module":1.75,"pressureAngle":19,"thickness":6,"bore":3,"hub":false,"lightening":false,"toothChamfer":true}`
- **kernel** (gear): extrude: the result is not a closed solid — `{"teeth":61,"module":4.5,"pressureAngle":24,"thickness":13.5,"bore":21,"hub":false,"lightening":false,"toothChamfer":true}`
- **hang**: no result after 60 s — `{"teeth":39,"module":2.25,"pressureAngle":18,"thickness":22,"bore":14,"hub":false,"lightening":false,"toothChamfer":true}`
- **kernel** (gear): extrude: the result is not a closed solid — `{"teeth":73,"module":1.5,"pressureAngle":22,"thickness":4.5,"bore":29.5,"hub":false,"lightening":true,"toothChamfer":false}`
- **kernel** (gear): extrude: the result is not a closed solid — `{"teeth":56,"module":5,"pressureAngle":17.5,"thickness":25.5,"bore":3.5,"hub":false,"lightening":true,"toothChamfer":false}`
- **kernel** (gear): extrude: the result is not a closed solid — `{"teeth":59,"module":4.25,"pressureAngle":22,"thickness":27,"bore":21.5,"hub":false,"lightening":true,"toothChamfer":true}`
- **kernel** (gear): chamfer: too large: the largest Distance that fits is 0.09493615448912804 — `{"teeth":41,"module":1.5,"pressureAngle":17.5,"thickness":12.5,"bore":3,"hub":false,"lightening":true,"toothChamfer":true}`
- … 18 more

### vase

- **kernel** (vase): shell: mass::enclosure: a face whose sides are not one material region and one void — `{"height":45,"base":45,"belly":74,"neck":70,"lip":10,"wall":4.3,"color":"porcelain"}`
