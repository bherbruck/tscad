/** The curated authoring guide returned by `tscad_docs` (topic "guide"). */
export const GUIDE = `# tscad authoring guide (for agents)

tscad is CAD as TSX: a model is a .tsx module whose default export is a function component
returning lowercase JSX elements (like tscircuit). It compiles to an exact B-rep (STEP) via the
solidcore kernel. **Units: millimetres and degrees. Z is up.**

## Model file shape

\`\`\`tsx
import { defineParams, edges, faces, type ParamValues } from "tscad"
import { CounterboreHole, BoltPattern, mountPatterns } from "tscad/parts" // optional library

export const params = defineParams({
  width: { type: "number", default: 60, min: 20, max: 200, step: 1, unit: "mm" },
  holes: { type: "int", default: 4, min: 0, max: 12 },
  rounded: { type: "boolean", default: true },
  style: { type: "choice", default: "slot", options: ["slot", "round"] },
  label: { type: "text", default: "tscad" },
})

export default function Bracket(p: ParamValues<typeof params>) {
  return (
    <part name="bracket" material="petg">
      <fillet radius={p.rounded ? 3 : 0} edges={edges.vertical()}>
        <difference>
          <box size={[p.width, 40, 6]} />
          <cylinder r={2.5} h={6} x={10} />
        </difference>
      </fillet>
    </part>
  )
}
\`\`\`

- No React import needed; JSX is configured (\`jsxImportSource: "tscad"\`). Components are plain
  functions, called at compile time; use \`.map\`, conditionals, helper functions freely.
- Several \`<part>\`s (optionally inside \`<assembly>\`) make a multi-part model. Solids outside any
  part go into one part named "part".
- \`radius={0}\` on fillet/chamfer skips it — handy for boolean params.

## Placement conventions (important)

- \`<box>\`, \`<cylinder>\`, \`<cone>\`: **centred in X/Y, base on z = 0** (\`center\` overrides:
  \`center\` = fully centred, \`center={[true,true,true]}\` per axis). \`<sphere>\`, \`<torus>\`: centred.
- Every solid element takes \`x y z\`, \`at={[x,y,z]}\`, \`rotate={[rx,ry,rz]}\` (degrees, X then Y
  then Z about the origin), \`rotateX/Y/Z\`, \`scale\`, \`mirror="x"\`. Order: mirror, scale, rotate,
  translate. \`<group>\` places several children together.
- So a hole through a 6 mm plate is \`<cylinder r={2} h={6} />\` (same base), and a pocket 2 deep
  from the top of a 6 mm plate is \`<cylinder r={4} h={2} z={4} />\`.

## Booleans

\`<difference>\` keeps the FIRST child and subtracts all others; \`<union>\`, \`<intersection>\`.
Several children of \`<part>\`/\`<group>\` are unioned.

## Sketches → solids

2D shapes live only inside \`<extrude>\`, \`<revolve>\`, \`<loft>\`, \`<sweep>\`, \`<drawing>\`:
\`<rect w h>\` (centred), \`<roundedRect w h r>\`, \`<circle r|d>\`, \`<ellipse rx ry>\`, \`<polygon points>\`,
\`<regularPolygon sides r|flats>\`, \`<slot length width>\`, \`<path d="M.. Z">\` (SVG subset, y up),
\`<star>\`, \`<text size align valign>label</text>\`, \`<offset distance>\` (grow/shrink), \`<sketch>\` group.
Each takes 2D placement \`x y rotate mirror\`.

- **Nested loops become holes automatically**: \`<extrude height={5}><rect w={40} h={30}/><circle r={5}/></extrude>\`
  is a plate with a hole. Disjoint loops are unioned.
- \`<extrude height plane="XY"|"XZ"|"YZ" offset center draft>\`: XY extrudes +Z from z = offset.
- \`<revolve angle={360}>\`: sketch x = radius, sketch y = height, about +Z. Keep x ≥ 0.
- \`<loft ruled?>\`: children are shapes each with \`z={..}\` (or \`<section z>\` wrappers), one loop each.
- \`<sweep path={helix({radius,pitch,turns}) | polyline3([...]) | arc3({...})}>\` one profile.

## Features and selectors

\`<fillet radius edges>\`, \`<chamfer distance edges>\`, \`<shell thickness open>\` wrap their children.
Selectors: strings \`">Z"\` (top), \`"<Z"\` (bottom), \`"|Z"\` (edges parallel to Z / faces with ±Z normal),
\`"#Z"\` (circles about Z), \`"*"\`, combined with \`and\`/\`or\`/\`not\`/parentheses; or builders
\`edges.top()\`, \`edges.bottom()\`, \`edges.vertical()\`, \`edges.circles()\`, \`edges.radius(r)\`,
\`edges.within(min,max)\`, \`.and() .or() .not()\`; \`faces.top()\` etc. Omit \`edges\` for all edges.
\`<shell thickness={2} open={faces.top()}>\` hollows inward (walls 2 mm) with the top open.
Use the \`tscad_pick_selectors\` tool with a point near an edge to get a selector for it.

## Patterns

\`<linearPattern count dx dy dz>\`, \`<gridPattern nx ny dx dy>\` (centred), \`<polarPattern count radius angle>\`,
\`<mirror axis="x" keep>\`. Wrap the *tool* in a pattern inside a \`<difference>\` for hole patterns.

## Parts library (tscad/parts)

ISO holes as cutting tools pointing −Z from z = 0 — put them at the top face (\`z={thickness}\`)
inside a \`<difference>\`: \`<Hole size="M3" depth={6} z={6}/>\`, \`<CounterboreHole>\`, \`<CountersinkHole>\`,
\`<TapHole>\`, \`<NutTrap>\`, \`<HeatSetInsert>\`; solids \`<Standoff size height>\`, \`<HexPrism>\`, \`<Extrusion2020>\`;
\`<BoltPattern pattern={mountPatterns.nema17}>{tool}</BoltPattern>\`; data \`metric\`, \`mountPatterns\`.

## Flat parts (laser/CNC)

\`<drawing name thickness?>{2D shapes}</drawing>\` compiles to exact 2D loops (export DXF/SVG); with
\`thickness\` it is also a 3D part.

## Kernel limits (avoid)

- Sweeps along paths with sharp corners fail; helix sweeps are slow (10–20 s).
- Fillet radius must be smaller than the adjacent faces allow (roughly < 0.5 × the shortest
  adjacent edge); filleting hundreds of edges is slow — fillet before patterning when possible.
- Inward shell of rounded-rect extrusions can fail; shell a box then fillet, or extrude walls.
- Keep models simple and evaluate often: \`tscad_evaluate\` reports every failing node with its
  TSX line.

## Workflow

1. \`tscad_docs\` (this) and \`tscad_docs\` with \`element\` for exact props; \`tscad_read_example\` for full models.
2. Write the TSX; \`tscad_evaluate\` it (source string or file). Fix errors (they point at TSX lines).
3. \`tscad_render\` to look at it (iso/top/front...). 4. \`tscad_export\` to STEP/STL/3MF/GLB/OBJ/DXF/SVG.
`;
