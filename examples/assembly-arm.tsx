/**
 * A two-link robot arm: a turntable on a base, an upper arm and a forearm, each a component
 * exposing joint anchors. Revolute mates driven by the angle params pose it, with no transforms
 * computed by hand.
 *
 *   tscad dev examples/assembly-arm.tsx
 */
import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  yaw: { type: "number", default: 30, min: -180, max: 180, step: 1, unit: "°", label: "Base yaw" },
  shoulder: { type: "number", default: 50, min: -10, max: 120, step: 1, unit: "°", label: "Shoulder" },
  elbow: { type: "number", default: -70, min: -150, max: 150, step: 1, unit: "°", label: "Elbow" },
  upper: { type: "number", default: 80, min: 40, max: 160, step: 1, unit: "mm", label: "Upper arm" },
  fore: { type: "number", default: 70, min: 30, max: 160, step: 1, unit: "mm", label: "Forearm" },
})

/** Base plate with the yaw axis on top. */
function Base() {
  return (
    <part name="base" color="#3d4451" fixed>
      <fillet radius={3} edges={edges.max("z")}>
        <cylinder r={40} h={12} />
      </fillet>
      <anchor id="yaw" at={[0, 0, 12]} />
    </part>
  )
}

/** Turntable with a clevis; the shoulder axis is horizontal (its x direction faces forward). */
function Turntable() {
  return (
    <part name="turntable" color="#c0392b">
      <cylinder r={30} h={10} />
      <box size={[24, 6, 36]} y={-12} z={10} />
      <box size={[24, 6, 36]} y={12} z={10} />
      <anchor id="yaw" />
      <anchor id="shoulder" at={[0, 0, 36]} axis="y" xAxis="x" />
    </part>
  )
}

/** A link of length `length` along its own +X, with joint anchors (axis +Y) at both ends. */
function Link({ name, length, width, color }: { name: string; length: number; width: number; color: string }) {
  return (
    <part name={name} color={color}>
      <union>
        <box size={[length, width, width]} center={[false, true, true]} />
        <cylinder r={width * 0.7} h={width + 2} center rotateX={90} />
        <cylinder r={width * 0.6} h={width + 2} center rotateX={90} x={length} />
      </union>
      <anchor id="root" axis="y" xAxis="x" />
      <anchor id="end" at={[length, 0, 0]} axis="y" xAxis="x" />
    </part>
  )
}

export default function Arm(p: ParamValues<typeof params>) {
  return (
    <assembly>
      <Base />
      <Turntable />
      <Link name="upper-arm" length={p.upper} width={16} color="#e67e22" />
      <Link name="forearm" length={p.fore} width={12} color="#f1c40f" />

      <mate a="base.yaw" b="turntable.yaw" type="revolute" angle={p.yaw} />
      {/* rotating about +Y tips +X down, so negate for "up" */}
      <mate a="turntable.shoulder" b="upper-arm.root" type="revolute" angle={-p.shoulder} />
      <mate a="upper-arm.end" b="forearm.root" type="revolute" angle={-p.elbow} />
    </assembly>
  )
}
