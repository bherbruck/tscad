/**
 * Enclosure: converted from OpenSCAD by `tscad convert`.
 * Lengths are millimetres and angles degrees, as in OpenSCAD.
 */

import { defineParams, type Children, type ParamValues } from "tscad"

export const params = defineParams({
  inner_x: { type: "int", default: 70, min: 20, max: 200, group: "Inside dimensions" },
  inner_y: { type: "int", default: 45, min: 20, max: 200, group: "Inside dimensions" },
  inner_z: { type: "int", default: 25, min: 10, max: 100, group: "Inside dimensions" },
  wall: { type: "number", default: 2, min: 1, max: 5, step: 0.2, group: "Walls" },
  floor_t: { type: "number", default: 2, min: 1, max: 5, step: 0.2, group: "Walls" },
  corner_r: { type: "number", default: 3, min: 0, max: 10, step: 0.5, group: "Walls" },
  post_d: { type: "number", default: 6, min: 4, max: 12, step: 0.5, group: "Screw posts" },
  screw_d: { type: "number", default: 2.5, min: 1.5, max: 5, step: 0.1, group: "Screw posts" },
  post_inset: { type: "int", default: 4, min: 3, max: 15, group: "Screw posts" },
})

/** OpenSCAD module rounded_box(size, r) */
function RoundedBox({ size, r }: { size: any[]; r: number }) {
  return (
    <extrude height={size[2]!}>
      <hull>
        {[r, $sub(size[0]!, r)].map((x: any) => [r, $sub(size[1]!, r)].map((y: any) => <sketch at={[x, y]}><circle r={r} /></sketch>))}
      </hull>
    </extrude>
  )
}

export default function Enclosure(p: ParamValues<typeof params>) {
  const { inner_x, inner_y, inner_z, wall, floor_t, corner_r, post_d, screw_d, post_inset } = p
  const eps = 0.01
  const outer = [inner_x + 2 * wall, inner_y + 2 * wall, inner_z + floor_t]
  /** OpenSCAD module post_positions() */
  function PostPositions({ children }: { children?: Children }) {
    return (
      <>
        {[wall + post_inset, $sub($sub(outer[0]!, wall), post_inset)].map((x: any) => (
          <>
            {[wall + post_inset, $sub($sub(outer[1]!, wall), post_inset)].map((y: any) => <translate by={[x, y, 0]}>{children}</translate>)}
          </>
        ))}
      </>
    )
  }
  /** OpenSCAD module enclosure() */
  function Enclosure() {
    return (
      <>
        <difference>
          <RoundedBox size={outer} r={corner_r} />
          <translate by={[wall, wall, floor_t]}>
            <box size={[inner_x, inner_y, inner_z + eps]} center={false} />
          </translate>
        </difference>
        <PostPositions>
          <difference>
            <cylinder r={post_d / 2} h={inner_z * 0.8 + floor_t} />
            <translate by={[0, 0, floor_t]}><cylinder r={screw_d / 2} h={inner_z} /></translate>
          </difference>
        </PostPositions>
      </>
    )
  }
  return <Enclosure />
}

// ---- OpenSCAD semantics used above

/** OpenSCAD -: numbers, or vectors element-wise. */
function $sub(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return a.slice(0, Math.min(a.length, b.length)).map((x, i) => $sub(x, b[i]))
  return typeof a === "number" && typeof b === "number" ? a - b : undefined
}
