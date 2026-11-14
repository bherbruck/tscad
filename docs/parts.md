# Standard parts

`tscad/parts` is a library of standard components built from ISO dimension tables. You use a
bolt by naming it, `<Bolt thread="M3" length={10} />`, rather than by modelling it from
cylinders and booleans. Every component is a plain function component with the usual placement
props (`x y z at rotate rotateX rotateY rotateZ mirror`).

## Fasteners and mechanical parts

| Component | Props | Frame and anchors | Named sub-solids |
|---|---|---|---|
| `<Bolt>` | `thread` (`"M2"` to `"M12"`), `length`, `head` (`"socket"` ISO 4762, `"hex"` ISO 4017, `"button"` ISO 7380, `"flat"` ISO 10642, `"pan"` ISO 7045), `cutter`, `headClearance` | the head's bearing face at z = 0, the shank down −Z; for `flat`, z = 0 is the flush top. Anchors `head`, `tip` | `head`, `shank`, `socket` |
| `<Nut>` | `thread`, `type` (`"hex"` ISO 4032, `"nyloc"` ISO 10511) | bearing face on z = 0, axis +Z. Anchors `face`, `top` | `body`, `bore` |
| `<Washer>` | `thread`, `type` (`"flat"` ISO 7089, `"spring"` DIN 127 B) | lying on z = 0. Anchors `bottom`, `top` | `body` |
| `<SetScrew>` | `thread`, `length` | ISO 4026 flat point, z 0 to length, socket at the top. Anchors `point`, `top` | `body`, `socket` |
| `<DowelPin>` | `d`, `length` | ISO 8734, z 0 to length, chamfered ends. Anchors `bottom`, `top` | `body` |
| `<Bearing>` | `designation` (`"608"`, `"625"`, `"6001"`, `"MR105"` and more, ISO 15) | axis Z, z 0 to width B. Anchors `face`, `back` | `outer`, `inner`, `shield` |
| `<ShaftCollar>` | `bore` (3, 4, 5, 6, 8, 10, 12 mm) | axis Z, z 0 to width, tapped radial hole along +X. Anchors `face`, `back` | `body`, `bore`, `screwHole` |

Threads are not modelled: shanks and bores are the nominal diameter. Sockets, head chamfers
and the nyloc insert's dome are modelled.

### A bolt and its own hole

Give a `<Bolt>` the `cutter` prop and it becomes the bolt's clearance cutter: an ISO 273
clearance hole down the shank, plus a pocket the shape of the head (a countersink for flat
heads). Put the same bolt in the same place twice, once as the cutter in a `<difference>` and
once as the part:

```tsx
import { Bolt, Nut } from "tscad/parts"

<assembly>
  <part name="plate">
    <difference>
      <box size={[40, 30, 6]} />
      <Bolt thread="M4" length={14} cutter x={-12} z={6} />
      <Bolt thread="M4" length={14} cutter x={12} z={6} />
    </difference>
  </part>
  <part name="bolts">
    <Bolt thread="M4" length={14} x={-12} z={6} />
    <Bolt thread="M4" length={14} x={12} z={6} />
  </part>
</assembly>
```

`cutter` takes `true` (the `"normal"` fit) or a fit: `"close"`, `"normal"` or `"loose"`. To sink
the head, place the bolt lower: the cutter's head pocket then becomes a counterbore.
`clearance(thread, fit)` returns the bare clearance diameter, for example `clearance("M3")` is
3.4.

### Mating

Each part's anchors work with `<mate>`. For example, this puts a nut's face against the
underside of a plate, on the bolt's axis:

```tsx
<mate a={A.plate.bottom} b={A.nut.face} type="fastened" />
```

### The tables

The dimensions are exported as data, so you can size your own geometry from them:
`boltHeads[style][thread]` (`dk`, `k`, socket `s` and `t`), `flatWashers`, `springWashers`,
`nylocHeight`, `setScrewSockets`, `bearings`, `shaftCollars`, and the hole data in `metric`
(clearance, tap drill, counterbore, countersink, nut). Where a standard has no row for a size
(ISO 7380 below M3, ISO 7045 at M12), the value follows the series and is noted in the source.

See [`examples/fasteners.tsx`](../examples/fasteners.tsx) for a bearing block bolted together
with all of them.

## Holes, hardware pockets, patterns, profiles

The rest of the library is cutting tools pointing −Z from z = 0:
- **Holes:** `Hole`, `CounterboreHole`, `CountersinkHole`, `TapHole`.
- **Hardware:** `NutTrap`, `HeatSetInsert`, and `Standoff` (a solid).
- **Patterns:** `BoltPattern`, `MountHoles`, `mountPatterns`.
- **Profiles:** `Extrusion2020`, `HexPrism`.
- **Laser-cut parts:** `FingerJointBox`, `LivingHinge`.
- **Boards:** `Board`, `BoardCase`, `boards`.

See the [API reference](api.md#tscadparts).
