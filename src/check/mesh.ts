/** Mesh helpers shared by the checks. */

/** The minimal mesh the checks read (a kernel `MeshArrays` fits). */
export interface CheckMesh {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** B-rep face of each triangle (optional; enables per-face summaries). */
  faceIds?: ArrayLike<number>;
}

/** Unit normal and area of each triangle (from positions and winding). */
export function triangleNormals(m: CheckMesh): { normals: Float64Array; areas: Float64Array; centroids: Float64Array } {
  const nt = Math.floor(m.indices.length / 3);
  const normals = new Float64Array(nt * 3), areas = new Float64Array(nt), centroids = new Float64Array(nt * 3);
  const P = m.positions, I = m.indices;
  for (let t = 0; t < nt; t++) {
    const a = I[3 * t]! * 3, b = I[3 * t + 1]! * 3, c = I[3 * t + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    areas[t] = l / 2;
    if (l > 0) normals.set([nx / l, ny / l, nz / l], t * 3);
    centroids.set([(P[a]! + P[b]! + P[c]!) / 3, (P[a + 1]! + P[b + 1]! + P[c + 1]!) / 3, (P[a + 2]! + P[b + 2]! + P[c + 2]!) / 3], t * 3);
  }
  return { normals, areas, centroids };
}

/** Axis-aligned bounds of the mesh. */
export function meshBounds(m: CheckMesh): [[number, number, number], [number, number, number]] {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = m.positions[i + k]!;
      if (v < lo[k]!) lo[k] = v;
      if (v > hi[k]!) hi[k] = v;
    }
  return [lo, hi];
}

/** Vertex ids welded by position (within `tol`, default 1e-6 × size). */
export function weld(m: CheckMesh, tol?: number): { ids: Uint32Array; count: number } {
  const [lo, hi] = meshBounds(m);
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);
  const q = 1 / (tol ?? size * 1e-6);
  const n = m.positions.length / 3;
  const ids = new Uint32Array(n);
  const map = new Map<string, number>();
  let count = 0;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(m.positions[3 * i]! * q)},${Math.round(m.positions[3 * i + 1]! * q)},${Math.round(m.positions[3 * i + 2]! * q)}`;
    let id = map.get(k);
    if (id === undefined) map.set(k, (id = count++));
    ids[i] = id;
  }
  return { ids, count };
}
