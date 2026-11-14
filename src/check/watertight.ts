/** Is a triangle mesh a closed, consistently oriented 2-manifold? */
import { weld, type CheckMesh } from "./mesh";

export interface WatertightResult {
  /** Closed, manifold and consistently oriented. */
  watertight: boolean;
  /** Edges used by one triangle only (holes / cracks). */
  boundaryEdges: number;
  /** Edges shared by more than two triangles. */
  nonManifoldEdges: number;
  /** Edges whose two triangles traverse them the same way (flipped triangles). */
  flippedEdges: number;
  /** Degenerate (zero-area / repeated-vertex) triangles. */
  degenerateTriangles: number;
  /** Connected shells. */
  shells: number;
  /** Euler characteristic V − E + F of the welded mesh (2 per sphere-like shell). */
  euler: number;
  /** Up to 20 boundary edges as welded vertex pairs, for debugging. */
  sampleBoundary: [number, number][];
}

/** Check that `mesh` is watertight. Vertices are welded by position first. */
export function checkWatertight(mesh: CheckMesh, opts: { tolerance?: number } = {}): WatertightResult {
  const { ids, count } = weld(mesh, opts.tolerance);
  const nt = Math.floor(mesh.indices.length / 3);
  // directed edge counts keyed by undirected pair
  const edges = new Map<number, { fwd: number; rev: number }>();
  let degenerate = 0;
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!;
    return x;
  };
  const used = new Uint8Array(count);
  for (let t = 0; t < nt; t++) {
    const v = [ids[mesh.indices[3 * t]!]!, ids[mesh.indices[3 * t + 1]!]!, ids[mesh.indices[3 * t + 2]!]!];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) {
      degenerate++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const a = v[k]!, b = v[(k + 1) % 3]!;
      used[a] = 1;
      const key = a < b ? a * count + b : b * count + a;
      let e = edges.get(key);
      if (!e) edges.set(key, (e = { fwd: 0, rev: 0 }));
      if (a < b) e.fwd++;
      else e.rev++;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  let boundary = 0, nonManifold = 0, flipped = 0;
  const sample: [number, number][] = [];
  for (const [key, e] of edges) {
    const n = e.fwd + e.rev;
    if (n === 1) {
      boundary++;
      if (sample.length < 20) sample.push([Math.floor(key / count), key % count]);
    } else if (n > 2) nonManifold++;
    else if (e.fwd !== 1) flipped++;
  }
  let V = 0, shells = 0;
  for (let i = 0; i < count; i++)
    if (used[i]) {
      V++;
      if (find(i) === i) shells++;
    }
  const F = nt - degenerate;
  return {
    watertight: boundary === 0 && nonManifold === 0 && flipped === 0 && F > 0,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    flippedEdges: flipped,
    degenerateTriangles: degenerate,
    shells,
    euler: V - edges.size + F,
    sampleBoundary: sample,
  };
}
