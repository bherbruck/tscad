/**
 * Pin hinge: two leaves with interleaved knuckles and a pin, assembled with revolute mates.
 * `limits` keeps the hinge between 0° and 180°; driving it past them warns at the mate.
 */
import { assemblyRefs, defineParams, type ParamValues } from "tscad"
import { CountersinkHole } from "tscad/parts"

export const params = defineParams({
  length: { type: "number", default: 60, min: 30, max: 150, step: 1, unit: "mm", label: "Length" },
  leaf: { type: "number", default: 20, min: 10, max: 50, step: 1, unit: "mm", label: "Leaf width" },
  knuckles: { type: "int", default: 5, min: 3, max: 9, step: 2, label: "Knuckles (odd)" },
  angle: { type: "number", default: 120, min: 0, max: 180, step: 1, unit: "°", label: "Open angle" },
})

const T = 2.5 // leaf thickness
const R = 4 // knuckle radius
const GAP = 0.4 // print clearance between knuckles

const A = assemblyRefs<{ leafA: "axis"; leafB: "axis"; pin: "axis" }>()

/** One leaf: a plate plus every other knuckle (`odd` picks which), axis along X at the origin. */
function Leaf({ name, length, width, knuckles, odd, color }: { name: string; length: number; width: number; knuckles: number; odd: boolean; color: string }) {
  const pitch = length / knuckles
  return (
    <part name={name} color={color} fixed={!odd}>
      <difference>
        <union>
          <box size={[length, width, T]} y={-width / 2 - R + 1} z={-T / 2} />
          {Array.from({ length: knuckles }, (_, i) =>
            (i % 2 === 1) === odd ? (
              <cylinder key={i} r={R} h={pitch - GAP} rotateY={90} x={-length / 2 + i * pitch + GAP / 2} />
            ) : null,
          )}
        </union>
        {/* pin bore */}
        <cylinder r={1.6} h={length + 2} rotateY={90} x={-length / 2 - 1} />
        {[-0.3, 0.3].map((f, i) => (
          <CountersinkHole key={i} size="M3" depth={T + 1} x={f * length} y={-width / 2 - R + 1} z={T / 2} />
        ))}
      </difference>
      <anchor id="axis" at={[0, 0, 0]} axis="x" />
    </part>
  )
}

export default function Hinge(p: ParamValues<typeof params>) {
  return (
    <assembly>
      <Leaf name={A.leafA.name} length={p.length} width={p.leaf} knuckles={p.knuckles} odd={false} color="#9aa4b2" />
      <Leaf name={A.leafB.name} length={p.length} width={p.leaf} knuckles={p.knuckles} odd color="#c0c8d4" />
      <part name={A.pin.name} color="#d4a843">
        <cylinder r={1.5} h={p.length} rotateY={90} x={-p.length / 2} />
        <anchor id="axis" at={[0, 0, 0]} axis="x" />
      </part>
      {/* leaf B starts folded flat onto A (180°) and opens by `angle` */}
      <mate a={A.leafA.axis} b={A.leafB.axis} type="revolute" angle={180 - p.angle} limits={[0, 180]} />
      <mate a={A.leafA.axis} b={A.pin.axis} type="fastened" />
    </assembly>
  )
}
