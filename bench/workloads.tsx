/**
 * Synthetic kernel workloads for profiling (bench/dump-ir.ts renders each to bench/ir/).
 * Each isolates one kind of work: many cuts, curved-curved booleans, sweeps, blends.
 */
import { edges, helix } from "tscad"

/** 24 slot holes in one sketch: one plate minus the union of 24 prisms. */
export function Plate24() {
  return (
    <part name="plate24">
      <extrude height={3}>
        <roundedRect w={84} h={59} r={4} />
        {Array.from({ length: 24 }, (_, i) => (
          <slot length={8} width={2} x={(i % 6) * 12 - 30} y={Math.floor(i / 6) * 10 - 15} />
        ))}
      </extrude>
    </part>
  )
}

/** Six overlapping spheres unioned (sphere/sphere intersections). */
export function SphereChain() {
  return (
    <part name="spheres">
      <union>
        {Array.from({ length: 6 }, (_, i) => (
          <sphere r={4} x={i * 7} />
        ))}
      </union>
    </part>
  )
}

/** A circle swept along a 3-turn helix (a spring). */
export function HelixSweep() {
  return (
    <part name="spring">
      <sweep path={helix({ radius: 10, pitch: 4, turns: 3 })}>
        <circle r={1} />
      </sweep>
    </part>
  )
}

/** A box with holes, every edge rounded (blend-heavy). */
export function FilletAll() {
  return (
    <part name="fillet-all">
      <fillet radius={1} edges={edges.all()}>
        <difference>
          <box size={[40, 30, 12]} />
          {[-12, 0, 12].map((x) => (
            <cylinder r={4} h={20} x={x} z={-4} />
          ))}
        </difference>
      </fillet>
    </part>
  )
}

/** A cylinder crossed by a rotated cylinder and a cone (curved-curved booleans). */
export function CurvedBooleans() {
  return (
    <part name="curved">
      <difference>
        <union>
          <cylinder r={10} h={30} />
          <cylinder r={6} h={40} rotateX={90} y={20} z={15} />
        </union>
        <cone r1={8} r2={2} h={32} z={-1} />
        <sphere r={7} x={8} y={-8} z={22} />
      </difference>
    </part>
  )
}
