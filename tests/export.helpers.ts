import type { Document } from "../src/ir";
import { loadKernel, type KernelHost } from "../src/kernel";

/** Small hand-written IR documents (no JSX core needed). */
export const docs = {
  box: { parts: [{ name: "block", color: "tomato", node: { type: "box", size: [20, 10, 5] } }] },
  filleted: {
    parts: [
      {
        name: "plate",
        color: "#3a7bd5",
        node: {
          type: "difference",
          children: [
            { type: "fillet", radius: 2, edges: { type: "parallel", axis: "z" }, children: [{ type: "box", size: [30, 20, 6] }] },
            { type: "transform", matrix: [1, 0, 0, 15, 0, 1, 0, 10, 0, 0, 1, -1, 0, 0, 0, 1], children: [{ type: "cylinder", radius: 4, height: 8 }] },
          ],
        },
      },
    ],
  },
  assembly: {
    parts: [
      { name: "base", color: "rgb(200, 200, 210)", node: { type: "box", size: [40, 40, 4] } },
      { name: "post", color: "orange", node: { type: "transform", matrix: [1, 0, 0, 20, 0, 1, 0, 20, 0, 0, 1, 4, 0, 0, 0, 1], children: [{ type: "cylinder", radius: 5, height: 20 }] } },
      { name: "ball", node: { type: "transform", matrix: [1, 0, 0, 20, 0, 1, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1], children: [{ type: "sphere", radius: 6 }] } },
    ],
  },
} satisfies Record<string, Document>;

export async function evaluated(doc: Document): Promise<{ kernel: KernelHost; volumes: Record<string, number> }> {
  const kernel = await loadKernel();
  const res = await kernel.evaluate(doc);
  if (!res.ok) throw new Error(JSON.stringify(res.parts.map((p) => p.error)));
  const volumes: Record<string, number> = {};
  for (const p of res.parts) volumes[p.name] = p.volume ?? NaN;
  return { kernel, volumes };
}

/** Signed volume of a triangle soup via the divergence theorem. */
export function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t]!, b = 3 * indices[t + 1]!, c = 3 * indices[t + 2]!;
    const p = positions;
    v += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!)
       - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!)
       + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return v / 6;
}

/** Edges not shared by exactly two triangles (0 = closed 2-manifold), after welding positions. */
export function openEdges(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  const key = (i: number) => `${positions[3 * i]},${positions[3 * i + 1]},${positions[3 * i + 2]}`;
  const ids = new Map<string, number>();
  const id = (i: number) => {
    const k = key(i);
    let v = ids.get(k);
    if (v === undefined) ids.set(k, (v = ids.size));
    return v;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const v = [id(indices[t]!), id(indices[t + 1]!), id(indices[t + 2]!)];
    for (let e = 0; e < 3; e++) {
      const a = v[e]!, b = v[(e + 1) % 3]!;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const n of edges.values()) if (n !== 2) bad++;
  return bad;
}

/** Parse a binary STL into a triangle soup. */
export function parseBinarySTL(bytes: Uint8Array): { count: number; positions: Float32Array; indices: Uint32Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + 4 * k, true);
  }
  return { count, positions, indices: Uint32Array.from({ length: count * 3 }, (_, i) => i) };
}
