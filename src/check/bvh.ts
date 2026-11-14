/**
 * A bounding volume hierarchy over a triangle mesh for fast ray casts (thickness checks).
 * Flat typed arrays; median split on the longest axis; leaves of ≤ 4 triangles.
 */
export interface Bvh {
  /** Per node: min xyz, max xyz. */
  bounds: Float64Array;
  /** Per node: left child (internal) or first triangle slot (leaf). */
  first: Int32Array;
  /** Per node: triangle count (leaf) or 0 (internal; right child = left + 1... stored in `right`). */
  count: Int32Array;
  right: Int32Array;
  /** Triangle indices in leaf order. */
  tris: Uint32Array;
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

const LEAF = 4;

/** Build a BVH over a triangle mesh (`positions` xyz, `indices` 3 per triangle). */
export function buildBvh(positions: ArrayLike<number>, indices: ArrayLike<number>): Bvh {
  const nt = Math.floor(indices.length / 3);
  const cx = new Float64Array(nt), cy = new Float64Array(nt), cz = new Float64Array(nt);
  const tb = new Float64Array(nt * 6);
  for (let t = 0; t < nt; t++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = indices[3 * t + k]! * 3;
      const x = positions[v]!, y = positions[v + 1]!, z = positions[v + 2]!;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    tb.set([x0, y0, z0, x1, y1, z1], t * 6);
    cx[t] = (x0 + x1) / 2; cy[t] = (y0 + y1) / 2; cz[t] = (z0 + z1) / 2;
  }
  const tris = new Uint32Array(nt);
  for (let i = 0; i < nt; i++) tris[i] = i;
  const maxNodes = Math.max(1, 2 * Math.ceil(nt / LEAF) * 2);
  const bounds = new Float64Array(maxNodes * 6);
  const first = new Int32Array(maxNodes), count = new Int32Array(maxNodes), right = new Int32Array(maxNodes);
  let nodes = 0;
  const cs = [cx, cy, cz];
  const build = (lo: number, hi: number): number => {
    const n = nodes++;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let c0x = Infinity, c0y = Infinity, c0z = Infinity, c1x = -Infinity, c1y = -Infinity, c1z = -Infinity;
    for (let i = lo; i < hi; i++) {
      const t = tris[i]! * 6;
      x0 = Math.min(x0, tb[t]!); y0 = Math.min(y0, tb[t + 1]!); z0 = Math.min(z0, tb[t + 2]!);
      x1 = Math.max(x1, tb[t + 3]!); y1 = Math.max(y1, tb[t + 4]!); z1 = Math.max(z1, tb[t + 5]!);
      const c = tris[i]!;
      c0x = Math.min(c0x, cx[c]!); c1x = Math.max(c1x, cx[c]!);
      c0y = Math.min(c0y, cy[c]!); c1y = Math.max(c1y, cy[c]!);
      c0z = Math.min(c0z, cz[c]!); c1z = Math.max(c1z, cz[c]!);
    }
    bounds.set([x0, y0, z0, x1, y1, z1], n * 6);
    if (hi - lo <= LEAF) {
      first[n] = lo;
      count[n] = hi - lo;
      return n;
    }
    const ext = [c1x - c0x, c1y - c0y, c1z - c0z];
    const axis = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : ext[1]! >= ext[2]! ? 1 : 2;
    const key = cs[axis]!;
    // median split (sort the slice by centroid)
    const slice = Array.from(tris.subarray(lo, hi)).sort((a, b) => key[a]! - key[b]!);
    tris.set(slice, lo);
    const mid = (lo + hi) >> 1;
    count[n] = 0;
    first[n] = build(lo, mid);
    right[n] = build(mid, hi);
    return n;
  };
  if (nt) build(0, nt);
  return { bounds, first, count, right, tris, positions, indices };
}

/** A ray hit: distance along the ray and the triangle index. */
export interface Hit {
  t: number;
  tri: number;
}

/**
 * Nearest hit of the ray `o + t·d` (t in (tMin, tMax)) with a triangle accepted by `accept`.
 */
export function raycast(b: Bvh, o: ArrayLike<number>, d: ArrayLike<number>, tMin = 0, tMax = Infinity, accept?: (tri: number) => boolean): Hit | undefined {
  if (!b.tris.length) return undefined;
  const ox = o[0]!, oy = o[1]!, oz = o[2]!, dx = d[0]!, dy = d[1]!, dz = d[2]!;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let best: Hit | undefined;
  let far = tMax;
  const stack = [0];
  const P = b.positions, I = b.indices, B = b.bounds;
  while (stack.length) {
    const n = stack.pop()!;
    const k = n * 6;
    // slab test
    let t0 = (B[k]! - ox) * ix, t1 = (B[k + 3]! - ox) * ix;
    if (t0 > t1) [t0, t1] = [t1, t0];
    let u0 = (B[k + 1]! - oy) * iy, u1 = (B[k + 4]! - oy) * iy;
    if (u0 > u1) [u0, u1] = [u1, u0];
    let w0 = (B[k + 2]! - oz) * iz, w1 = (B[k + 5]! - oz) * iz;
    if (w0 > w1) [w0, w1] = [w1, w0];
    const enter = Math.max(t0, u0, w0, tMin), exit = Math.min(t1, u1, w1, far);
    if (!(enter <= exit)) continue;
    if (b.count[n]) {
      for (let i = b.first[n]!; i < b.first[n]! + b.count[n]!; i++) {
        const tri = b.tris[i]!;
        const a = I[3 * tri]! * 3, c = I[3 * tri + 1]! * 3, e = I[3 * tri + 2]! * 3;
        // Möller–Trumbore
        const e1x = P[c]! - P[a]!, e1y = P[c + 1]! - P[a + 1]!, e1z = P[c + 2]! - P[a + 2]!;
        const e2x = P[e]! - P[a]!, e2y = P[e + 1]! - P[a + 1]!, e2z = P[e + 2]! - P[a + 2]!;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det;
        const sx = ox - P[a]!, sy = oy - P[a + 1]!, sz = oz - P[a + 2]!;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > tMin && t < far && (!accept || accept(tri))) {
          far = t;
          best = { t, tri };
        }
      }
    } else stack.push(b.first[n]!, b.right[n]!);
  }
  return best;
}
