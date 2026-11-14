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
\`<star>\`, \`<text size align valign>label</text>\`, \`<offset distance>\` (grow/shrink), \`<hull>\` (convex hull of
its children), \`<difference2d>\`/\`<union2d>\`/\`<intersection2d>\`, \`<sketch>\` group. Each takes 2D placement \`x y rotate mirror\`.

- **2D booleans**: \`<difference2d>\` (first child minus the rest), \`<union2d>\`, \`<intersection2d>\` (long
  names \`<sketchDifference>\` etc.) combine 2D shapes exactly (arcs stay arcs) — a D-shaft profile is
  \`<difference2d><circle d={6}/><rect w={7} h={3} y={3}/></difference2d>\`, a keyhole a \`<union2d>\` of a
  circle and a slot, a fluted rim a circle minus small circles. Much faster than 3D cuts: one extrude.
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
\`<draft angle={3}>\` tilts the walls for moulding; \`<pushPull distance={2} faces=">Z">\` moves faces along
their normals; \`<split plane="XY" offset={5} keep="above">\` cuts with a plane and keeps one side.
Use the \`tscad_pick_selectors\` tool with a point near an edge to get a selector for it.

## Assemblies: anchors and mates

Model each part at its own origin, put \`<anchor id at axis>\` frames on it, and join parts with
\`<mate a="part.anchor" b="part.anchor" type>\` inside an \`<assembly>\`; the solver moves them into place.
Types: \`fastened\` (default), \`revolute\` (\`angle\`), \`slider\` (\`offset\`), \`cylindrical\`, \`planar\`, \`ball\`;
\`limits={[min, max]}\`; \`<gear a="mateId" b="mateId" ratio>\` couples two joints. Mark one part \`fixed\`.

\`\`\`tsx
<assembly>
  <part name="base" fixed><box size={[40, 40, 10]} /><anchor id="pivot" at={[0, 0, 10]} axis="z" /></part>
  <part name="arm"><box size={[60, 8, 4]} x={30} /><anchor id="root" at={[0, 0, 0]} axis="z" /></part>
  <mate a="base.pivot" b="arm.root" type="revolute" angle={p.angle} />
</assembly>
\`\`\`

A simpler alternative for fixed layouts: place parts with \`x y z rotate\` directly. Check fits with
\`tscad_check\` (it reports the volume where parts overlap). Constraint-solved 2D sketches
(\`<sketch>\` with \`<point> <line> <arc>\` + constraints) are documented under \`{"element": "line"}\` etc.

## Patterns

\`<linearPattern count dx dy dz>\`, \`<gridPattern nx ny dx dy>\` (centred), \`<polarPattern count radius angle>\`,
\`<mirror axis="x" keep>\`. Wrap the *tool* in a pattern inside a \`<difference>\` for hole patterns.

## Parts library (tscad/parts)

ISO holes as cutting tools pointing −Z from z = 0 — put them at the top face (\`z={thickness}\`)
inside a \`<difference>\`: \`<Hole size="M3" depth={6} z={6}/>\`, \`<CounterboreHole>\`, \`<CountersinkHole>\`,
\`<TapHole>\`, \`<NutTrap>\`, \`<HeatSetInsert>\`; solids \`<Standoff size height>\`, \`<HexPrism>\`, \`<Extrusion2020>\`;
\`<BoltPattern pattern={mountPatterns.nema17}>{tool}</BoltPattern>\`; data \`metric\`, \`mountPatterns\`.
Boards: \`boards.raspberryPi5 | raspberryPi4 | raspberryPiZero2W | pico | arduinoUno | esp32DevKitC\` with every
connector as data; \`<Board board>\` (a 3D model with anchors per connector and hole) and
\`<BoardCase board ports="auto" vents lid>\` — a complete enclosure: standoffs, port openings where
connectors face the walls, a vented lid, the board mated in (check it with \`tscad_check\`).

## Flat parts (laser/CNC)

\`<drawing name layer? thickness?>{2D shapes}</drawing>\` compiles to exact 2D loops (export DXF/SVG);
\`layer="cut"\` / \`"engrave"\` become DXF layers; with \`thickness\` it is also a 3D part. For kerf, wrap the
shapes in \`<offset distance={kerf / 2} round={false}>\`. Generators: \`<FingerJointBox>\` (finger-jointed box,
flat or \`assembled\`) and \`<LivingHinge>\` from tscad/parts. To preview the assembled product, add
\`<part>\`s that extrude the same shape components (reuse one component for the 2D and the 3D).

## Kernel limits (avoid)

- Sweeps along paths with sharp corners fail; helix sweeps are slow (10–20 s).
- Fillet radius must be smaller than the adjacent faces allow (roughly < 0.5 × the shortest
  adjacent edge); filleting hundreds of edges is slow — fillet before patterning when possible.
- Inward shell of rounded-rect extrusions can fail; shell a box then fillet, or extrude walls.
- Keep models simple and evaluate often: \`tscad_evaluate\` reports every failing node with its
  TSX line.

## Printing

\`tscad_check\` reports overhangs, thin walls and bed fit, and suggests a better \`buildDir\` when the part
would print with fewer overhangs another way up (lids upside down, profiles on their side).
Horizontal holes print cleanly as teardrops (a circle plus a 45° roof); a flat ceiling is an overhang.

## Common mistakes

- \`rotate={90}\` → \`rotateZ={90}\` or \`rotate={[0, 0, 90]}\`. \`size={[w, d]}\` on a box needs three numbers.
- Parts-library components are capitalised and must be imported: \`import { Hole } from "tscad/parts"\`.
- Holes from tscad/parts point down from z = 0: place them at the *top* face (\`z={thickness}\`).
- A cut that only touches a face leaves a skin: make tools a little longer than the solid.
- \`<split plane="XZ" keep="below">\` keeps −Y (keep follows the plane's normal: XY +Z, XZ +Y, YZ +X).
- Fillet before cutting many holes/patterns and keep radii below half the shortest edge.

## Workflow

1. \`tscad_docs\` (this) and \`tscad_docs\` with \`element\` for exact props; \`tscad_read_example\` for full models.
2. Write the TSX; \`tscad_evaluate\` it (source string or file). Fix errors (they point at TSX lines).
3. \`tscad_render\` to look at it (iso/top/front...). 4. \`tscad_check\` for printability (overhangs,
thin walls, bed fit) and part interference. 5. \`tscad_export\` to STEP/STL/3MF/GLB/OBJ/DXF/SVG, or \`tscad_plate\` to orient the parts and lay them out on print beds (3MF per plate).
`;
