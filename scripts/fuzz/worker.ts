/** Fuzz worker: owns one kernel session, evaluates single-part documents, checks meshes. */
import type { Node } from "../../src/ir";
import { KernelPanic, loadKernel } from "../../src/kernel";

declare const self: Worker;

export interface EvalRequest {
  id: number;
  node: Node;
  /** Also mesh it and measure the mesh. */
  mesh: boolean;
}
export interface EvalReply {
  id: number;
  status: "ok" | "empty" | "error" | "panic" | "throw";
  volume?: number;
  op?: string;
  path?: string;
  message?: string;
  warnings?: string[];
  millis: number;
  meshVolume?: number;
  meshError?: string;
  openEdges?: number;
  triangles?: number;
  bboxDiag?: number;
}

const kernel = await loadKernel();

function measure(positions: Float32Array, indices: Uint32Array) {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t]!, b = 3 * indices[t + 1]!, c = 3 * indices[t + 2]!;
    const p = positions;
    v += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  // open edges after welding exactly-equal positions
  const ids = new Map<string, number>();
  const id = (i: number) => {
    const k = `${positions[3 * i]},${positions[3 * i + 1]},${positions[3 * i + 2]}`;
    let x = ids.get(k);
    if (x === undefined) ids.set(k, (x = ids.size));
    return x;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const w = [id(indices[t]!), id(indices[t + 1]!), id(indices[t + 2]!)];
    if (w[0] === w[1] || w[1] === w[2] || w[0] === w[2]) continue;
    for (let e = 0; e < 3; e++) {
      const a = w[e]!, b = w[(e + 1) % 3]!;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  return { volume: v / 6, open };
}

self.onmessage = async (ev: MessageEvent<EvalRequest>) => {
  const { id, node, mesh } = ev.data;
  const t0 = performance.now();
  const reply: EvalReply = { id, status: "ok", millis: 0 };
  try {
    const res = await kernel.evaluate({ parts: [{ name: "f", node }] }, { noMesh: true });
    const p = res.parts[0]!;
    reply.millis = performance.now() - t0;
    reply.warnings = p.warnings;
    if (!p.ok) {
      reply.status = "error";
      reply.op = p.error?.op;
      reply.path = p.error?.path;
      reply.message = p.error?.message;
    } else if (p.empty) {
      reply.status = "empty";
      reply.volume = 0;
    } else {
      reply.volume = p.volume ?? NaN;
      if (p.bbox) reply.bboxDiag = Math.hypot(...p.bbox[1].map((v, i) => v - p.bbox![0][i]!));
      if (mesh) {
        try {
          const tol = Math.max(1e-3, (reply.bboxDiag ?? 10) * 5e-4);
          const m = await kernel.meshAt("f", tol);
          const r = measure(m.positions, m.indices);
          reply.meshVolume = r.volume;
          reply.openEdges = r.open;
          reply.triangles = m.indices.length / 3;
        } catch (e) {
          if (e instanceof KernelPanic) {
            reply.status = "panic";
            reply.op = "meshAt";
            reply.message = e.message;
          } else reply.meshError = String((e as Error)?.message ?? e);
        }
      }
    }
  } catch (e) {
    reply.millis = performance.now() - t0;
    if (e instanceof KernelPanic) {
      reply.status = "panic";
      reply.message = e.message;
    } else {
      reply.status = "throw";
      reply.message = String((e as Error)?.message ?? e);
    }
  }
  self.postMessage(reply);
};
self.postMessage({ ready: true });
