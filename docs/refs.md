# Refs: operate on named solids

Nesting is how tscad combines solids: `<difference>` wraps the body and its tools, and
`<fillet>` wraps what it rounds. That works until the solid you want to change lives inside a
component someone else wrote. Refs let you reach in from outside instead: give solids (and
component calls) a `name`, then point an operation at them with a selector.

```tsx
import { edges } from "tscad"
import { Bolt } from "tscad/parts"

export default function Bracket() {
  return (
    <part name="bracket">
      <box name="plate" size={[40, 20, 4]} />
      <Bolt name="bolt" thread="M3" length={12} z={4} />
      <subtract from=".plate" tool=".bolt > .shank" />
      <fillet target=".plate" radius={1} edges={edges.max("z")} />
    </part>
  )
}
```

The plate loses a hole where the bolt's shank passes through it, the shank is used up (it is no
longer in the output), and the plate keeps its name, so the fillet that follows still finds it.
Nesting keeps working as before; refs are an extra way to say the same thing.

## Names

- Every solid element takes `name`: `<box name="plate">`, `<extrude name="rib">`,
  `<group name="frame">`, `<difference name="body">`...
- So does every component call: `<Bolt name="bolt" />`. The component doesn't need to do
  anything with it; tscad records the call's name itself.
- A name doesn't have to be unique. Selectors with a parent (`.bolt > .shank`) tell repeated
  names apart.
- `<part name>`, `<assembly name>` and `<drawing name>` keep their old meaning (the part or
  drawing name in exports) and are not refs.

## Selectors

| Selector | Picks |
|---|---|
| `.plate` | every solid named `plate` |
| `.bolt > .shank` | a `shank` whose nearest named ancestor is `bolt` |
| `.bolt .shank` | a `shank` anywhere inside `bolt` |
| `.a, .b` | both |

"Ancestor" means the nearest *named* element or component call above it. Unnamed wrappers
(`<group>`, `<translate>`, a component without a name) don't count, so `.bolt > .shank`
still works when the bolt's shank sits inside a placement group. Names are written like CSS
classes, with a leading dot; `"plate"` without the dot is an error that says so.

## Operations

| Element | Does |
|---|---|
| `<subtract from=".a" tool=".b" />` | cuts the tool(s) from `from`. `<difference from tool>` is the same. |
| `<union of=".a, .b" />` | unites them; the first one keeps its place and name |
| `<intersect of=".a, .b" />` | keeps what they share (`<intersection of>` is the same) |
| `<fillet target=".a" radius edges />` | rounds edges of one solid |
| `<chamfer target=".a" distance edges />` | bevels edges of one solid |
| `<shell target=".a" thickness open />` | hollows one solid |
| `<draft target=".a" angle />` | drafts faces of one solid |

These are the same elements you already nest; giving them `from`/`tool`, `of` or `target`
instead of children switches them to refs. Everything else (`radius`, `edges`, `open`...) means
what it always did, and selectors such as `edges.max("z")` are measured on the target where it
sits in the tree, exactly as if the feature wrapped it there.

What happens to the solids:

- The result replaces `from` (or `target`, or the first `of`) in the tree, keeps its name and
  keeps its position. Later refs to that name see the result.
- Tools, and the extra solids of `of`, are **used up**: they are moved into the result (their
  placement is kept, whatever groups and transforms sit between them) and removed from where
  they were. A later ref to a used-up solid is an error that names the op that used it.
- `from`, `target` and each `of` solid must be a single solid. A selector that matches several
  is an error listing the matches, with a hint to qualify it (`.bolt > .shank`). `tool` may
  match several; all of them are cut.
- A ref op has no placement of its own: `x`, `rotate` and friends on it are an error.

## Scope

Refs resolve after the solids around them are built, in the order the ops are written, so an op
may refer to a solid written after it.

- **The part.** An op reaches the named solids of its own `<part>` (or, without parts, of
  the model's loose solids). Parts are separate bodies, so a ref can't cross into another part;
  the error says which part the name is in.
- **The component call.** An op written inside a component reaches only what that call
  rendered. A `CounterboredBoss` component that does `<subtract from=".body" tool=".bore" />`
  works when you place five of them in one part: each call cuts its own bore. Ops written in
  the top-level model component (the one that renders the `<part>`) see the whole part.

Patterns repeat one solid in several places, so a name inside a `<linearPattern>` matches it
several times and ref ops refuse it. Name the pattern itself, or do the op inside the
patterned component.

## Errors

Every error points at the line of the op that failed:

```
bracket.tsx:9:7: <subtract> from=".plat" matches nothing in part "bracket"
  hint: did you mean ".plate"? Named here: .bolt, .bolt > .shank, .bolt > .head, .plate
```

```
<fillet> target=".shank" matches 2 solids: .left > .shank, .right > .shank
  hint: qualify it with the parent's name, e.g. .bolt > .shank
```

## For component authors

- Name the sub-solids people may want to reach: `head`, `shank`, `body`, `bore`. Use one
  element per name; a ref used as `from` or `target` must be one solid.
- Don't put the instance's own name on your root element (that would make `.bolt > .bolt`); the
  call's `name` is recorded for you.
- A component that returns several separate solids can still be a `tool` by its call name, but
  not a `from` or `target`. Wrap them in one `<group>` if they belong together.

## Why

For people this is about composition: you can drill through, round or hollow a solid that came
from a library without forking the component. For AI agents writing models through the
[MCP server](mcp.md) it is also shorter: `<subtract from=".plate" tool=".bolt > .shank" />` is
one line, where the nested form means restructuring the tree around the plate.
