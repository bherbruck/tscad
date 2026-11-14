# Assemblies: anchors and mates

Put **anchors** (named frames) on parts and join them with **mates** inside an `<assembly>`.
A solver moves each part rigidly to satisfy the mates, so you model each part where it is
convenient (usually at its own origin) and say how the parts connect. Driven joint values
(`angle`, `offset`) are ordinary expressions, so a param slider moves a joint.

```tsx
<assembly>
  <part name="base" fixed>
    <box size={[60, 40, 10]} />
    <anchor id="hinge" at={[0, 20, 10]} axis="x" />
  </part>
  <part name="lid">
    <box size={[60, 40, 4]} />
    <anchor id="hinge" at={[0, 20, 0]} axis="x" />
  </part>
  <mate a="base.hinge" b="lid.hinge" type="revolute" angle={-p.open} />
</assembly>
```

## `<anchor>`

`<anchor id at axis xAxis />` goes anywhere inside a part, including inside components and
transforms. It builds no geometry, and it carries every placement around it (part `x`/`rotate`,
`<translate>`, `<rotate>`, `<mirror>`...). So a component such as a motor can expose `shaft`,
`mount1`...

| Prop | Meaning |
|---|---|
| `id` | name, unique in its part (no dots); referenced as `"part.id"` |
| `at` / `x` `y` `z` | origin, mm |
| `axis` | its local z: `"x"`, `"-y"`... or `[x, y, z]` (default `"z"`) |
| `xAxis` | its local x, projected square to `axis` (default X, or Y when the axis is along X) |

Anchors inside a pattern take the first copy's position. Anchors in loose solids belong to the
implicit part.

## `<mate>`

`<mate a b type offset angle flip />`, directly inside an `<assembly>`. `b`'s part moves so
that its anchor frame lands on `a`'s frame, shifted by `offset` along `a`'s axis, turned by
`angle` about it, and with axes opposed when `flip` is set:

| `type` | constrains | free (driven by) |
|---|---|---|
| `fastened` (default) | origin, axis, x direction | none |
| `revolute` | origin, axis | rotation about the axis (`angle`) |
| `slider` | axis, x direction, origin on `a`'s axis line | travel along the axis (`offset`) |
| `cylindrical` | axis, origin on the axis line | rotation (`angle`) and travel (`offset`) |
| `planar` | axis, distance along it (`offset`, default 0) | in-plane travel, rotation (`angle`) |
| `ball` | origin (+ `offset` along `a`'s axis) | all rotation |

Giving `angle`/`offset` on a joint drives that freedom (a revolute with `angle` is fully fixed).
`angle` turns `b` about `a`'s axis by the right-hand rule.

**Grounding.** Parts with `fixed` never move. If no part is `fixed`, the first part is grounded.
Parts in no mate stay where they are. Grounding is per assembly (see nesting).

**Limits.** `limits={[min, max]}` gives a joint's allowed range: degrees of `angle` for
revolute/cylindrical/planar joints, mm of `offset` for a slider. When the solved position is
outside it (driven, or through a gear), a warning is emitted at the mate.

## `<gear>`: coupled joints

Give joints an `id`, then couple their angles: `b`'s angle = `ratio` × `a`'s angle + `phase`.
A negative ratio turns the other way, as meshing spur gears do.

```tsx
<mate id="drive"  a="frame.a" b="pinion.hub" type="revolute" angle={p.turn} />
<mate id="driven" a="frame.b" b="wheel.hub"  type="revolute" />
<gear a="drive" b="driven" ratio={-teethPinion / teethWheel} />
```

`a` and `b` must name revolute or cylindrical mates of the same assembly. A joint's angle is
measured as the rotation of `b`'s x direction about `a`'s axis (`atan2(xB·yA, xB·xA)`).

## Nested assemblies

Mates are scoped to the `<assembly>` they're written in, and inner assemblies are solved first:

1. Each inner assembly solves its own mates, with its own grounded part.
2. In the parent, the solved inner assembly is one **rigid group**: its anchors are addressed
   `"sub.part.anchor"` (`sub` = the inner `<assembly name>`), or just `"part.anchor"` when that
   is unambiguous. A mate moves the whole group.
3. A mate can't reach outside its assembly: `no anchor "table.top" in this assembly`.

`<assembly fixed>` grounds a sub-assembly in its parent, and `<assembly name>` names it.
So a component can be a whole mechanism (say, a gripper with its own joints) that is placed
as a unit.

## Referencing anchors: strings or typed handles

```tsx
const A = assemblyRefs<{ motor: "shaft" | "mount"; pulley: "bore" }>()
<part name={A.motor.name}>...<anchor id="shaft" ... /></part>
<mate a={A.motor.shaft} b={A.pulley.bore} type="revolute" angle={p.turn} />
```

`A.part.name` is the part name, and `A.part.anchorId` is a handle that stands for
`"part.anchorId"`. With the type argument, a misspelt anchor or part doesn't compile.
`"part.anchor"` strings work everywhere too, and the two styles mix.

## Solver

**Cache.** Each assembly level's solve is cached (LRU, 64 entries) by its units' anchor frames,
names and locations and its mates' props. A param change that leaves the mates alone (a
size, a colour) skips the solve and replays its warnings. `clearAssemblyCache()` empties it.

The sketch solver (`src/core/sketch/solver`) is reused. Each moving part has 7 unknowns: a
translation and a quaternion, kept unit by a residual. Each mate adds residual equations
between the two world anchor frames: origin coincidence, axis equality (`zB = ±zA`), x
alignment (`xB = cos θ xA + sin θ yA`), point on axis line, and distance along the axis.
Orientation residuals are scaled by the assembly size. The Jacobian is exact (dual numbers), and
Levenberg–Marquardt takes minimum-norm steps. The initial guess walks the mates out from the
ground and places each newly reached part exactly on its mate. Open chains therefore start
solved, closed loops (four-bars) converge from there, and free joints keep their drawn position.

## Diagnostics

All carry JSX source locations.

- **Free parts** (warning): `part "arm" can still move: 1 degree of freedom left by its mates`.
  This is per-part DOF relative to the ground: the rank of the null space restricted to that part.
  `<assembly allowFree>` silences it. `<assembly strict>` makes it an error and also reports
  redundant mates. Closing a planar loop with revolutes is redundant in 3D, so redundancy is
  quiet by default.
- **Conflicts** (error, at the later mate):
  `over-constrained assembly: <mate a="g.base" b="arm.tip" type="fastened"> conflicts with <mate a="g.tip" b="arm.base" type="fastened"> (model.tsx:12)`.
- **Missing anchors**: `a: no anchor "g.tpi"`, with a "did you mean" hint, the part's anchor
  list, or the list of part names. A `<mate>` outside an `<assembly>` is an error.

## Compile-result metadata (`result.assembly`)

Present when the model has any `<anchor>` or `<mate>`:

```ts
interface AssemblyInfo {
  parts: {
    name: string;
    transform: number[];  // 4×4 row-major rigid motion applied on top of the declared placement
    dof: number;          // remaining freedom relative to ground (0 = fully placed); for a part in
                          // a sub-assembly, its own level plus its group's freedom in the parents
    grounded: boolean;
  }[];
  mates: {
    a: string; b: string;           // "part.anchor"
    type: "fastened" | "revolute" | "slider" | "cylindrical" | "planar" | "ball";
    id?: string;                    // the mate's id (for gears)
    angle?: number; offset?: number; flip: boolean;  // driven values, as given
    value: { angle: number; offset: number };        // solved joint position: degrees about a's
                                                     // axis, mm along it (for gizmos and limits)
    limits?: [number, number];
    residual: number;               // mm, at the solution
    ok: boolean;
    loc?: SourceLoc;
  }[];
  anchors: {
    part: string; id: string;
    frame: number[];      // 4×4 row-major, model space after solving: columns x, y, z axes, origin
    loc?: SourceLoc;
  }[];
}
```

For anchor triads, draw `frame`'s three axis columns from its origin column. For joint gizmos,
draw a ring for a revolute or an arrow for a slider at the `a` anchor's frame. In the IR, a
moved part's root node is a `transform` holding the solved motion: it is merged into the root
transform when there is one, otherwise the root is wrapped in a new transform.

## Examples

- `examples/assembly-hinge-box.tsx`: shelled box and lid on a revolute hinge, `open` param,
  typed handles, limits. The hinge anchors sit on the shared back edge (the box's top, the
  lid's bottom), so the lid is flush when closed and pivots on that edge.
- `examples/assembly-arm.tsx`: base, turntable, upper arm and forearm components with joint
  anchors, posed by `yaw` / `shoulder` / `elbow` params.
