/**
 * Gear pair: two involute spur gears on a plate, meshed by a `<gear>` coupling between their
 * revolute mates. Turn the drive gear with the `turn` param; the driven gear follows at the
 * tooth ratio.
 */
import { assemblyRefs, defineParams, type ParamValues } from "tscad"
import { involuteGear } from "../spur-gear"

export const params = defineParams({
  driveTeeth: { type: "int", default: 12, min: 8, max: 40, label: "Drive teeth" },
  drivenTeeth: { type: "int", default: 24, min: 8, max: 60, label: "Driven teeth" },
  module: { type: "number", default: 2, min: 1, max: 4, step: 0.25, unit: "mm", label: "Module" },
  turn: { type: "number", default: 0, min: 0, max: 360, step: 1, unit: "°", label: "Drive angle" },
})

const A = assemblyRefs<{ plate: "a" | "b"; drive: "hub"; driven: "hub" }>()

/** A gear of `teeth` teeth, its hub anchor on its axis. */
function Gear({ name, teeth, module: m, color }: { name: string; teeth: number; module: number; color: string }) {
  return (
    <part name={name} color={color}>
      <difference>
        <extrude height={6}>
          <path d={involuteGear(teeth, m, 20)} />
        </extrude>
        <cylinder d={5} h={6} />
      </difference>
      <anchor id="hub" at={[0, 0, 0]} axis="z" />
    </part>
  )
}

export default function GearPair(p: ParamValues<typeof params>) {
  const centre = (p.module * (p.driveTeeth + p.drivenTeeth)) / 2
  const r2 = (p.module * p.drivenTeeth) / 2 + p.module
  return (
    <assembly>
      <part name={A.plate.name} color="#3d4452" fixed>
        <box size={[centre + 2 * r2 + 10, 2 * r2 + 10, 4]} x={centre / 2} z={-4} />
        <cylinder d={4.8} h={10} />
        <cylinder d={4.8} h={10} x={centre} />
        <anchor id="a" at={[0, 0, 0.5]} axis="z" />
        <anchor id="b" at={[centre, 0, 0.5]} axis="z" />
      </part>
      <Gear name={A.drive.name} teeth={p.driveTeeth} module={p.module} color="#d08a2e" />
      <Gear name={A.driven.name} teeth={p.drivenTeeth} module={p.module} color="#7aa6d6" />
      <mate id="driveJoint" a={A.plate.a} b={A.drive.hub} type="revolute" angle={p.turn} />
      {/* the driven gear starts half a tooth around so the teeth interleave */}
      <mate id="drivenJoint" a={A.plate.b} b={A.driven.hub} type="revolute" />
      <gear a="driveJoint" b="drivenJoint" ratio={-p.driveTeeth / p.drivenTeeth} phase={180 / p.drivenTeeth} />
    </assembly>
  )
}
