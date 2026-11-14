/**
 * 3D-printability checks on a triangle mesh: overhangs (per triangle, grouped by B-rep face),
 * wall thickness (a ray cast inward from every triangle against a BVH), bed fit and small
 * features.
 */
import { buildBvh, raycast } from "./bvh";
import { meshBounds, triangleNormals, type CheckMesh } from "./mesh";

/** `[x, y, z]`. */
export type Vec3 = [number, number, number];

/** Options for {@link checkPrintability}. */
export interface PrintabilityOptions {
  /** Build direction (the printer's +Z in model space). Default `[0, 0, 1]`. */
  buildDir?: Vec3;
  /** Steepest printable overhang, degrees from vertical. Default 45. */
  maxOverhangDeg?: number;
  /** Thinnest printable wall, mm. Default 0.8 (two 0.4 mm perimeters). */
  minWall?: number;
  /** Build volume `[x, y, z]`, mm (x/y may be swapped to fit). */
  bed?: Vec3;
  /**
   * Faces within this distance of the lowest point (along `buildDir`) rest on the bed and are
   * never overhangs, mm. Default 0.01.
   */
  bedTolerance?: number;
  /** Skip the wall-thickness ray casts (faster). Default false. */
  skipThickness?: boolean;
}

/** Overhang area grouped by B-rep face. */
export interface OverhangFace {
  /** B-rep face id (when the mesh has `faceIds`), else −1. */
  faceId: number;
  /** Overhanging area, mm². */
  area: number;
  /** Worst angle below horizontal... as degrees from vertical (90 = a flat ceiling). */
  maxAngle: number;
}

/** What {@link checkPrintability} found. Per-triangle arrays follow `mesh.indices` order. */
export interface PrintabilityResult {
  overhang: {
    /** Total overhanging area, mm². */
    area: number;
    /** `area` / total surface area. */
    fraction: number;
    /** Indices of overhanging triangles. */
    triangles: Uint32Array;
    /**
     * Per triangle: 0 = fine, else (0, 1] = how far past the limit
     * ((angle − max) / (90 − max)); 1 = a flat ceiling. For a viewer heatmap.
     */
    severity: Float32Array;
    /** Grouped by B-rep face, largest first. */
    faces: OverhangFace[];
  };
  thickness?: {
    /** Per triangle: wall thickness measured inward from its centroid, mm (Infinity: no opposite wall found). */
    byTriangle: Float32Array;
    /** Per vertex: the smallest thickness of the triangles using it, mm. */
    byVertex: Float32Array;
    /** Thinnest wall found, mm. */
    min: number;
    /** Area of triangles thinner than `minWall`, mm². */
    thinArea: number;
    /** `thinArea` / total area. */
    thinFraction: number;
    /** Thin triangles. */
    thinTriangles: Uint32Array;
  };
  /** Size along the build axes `[x, y, z]` (z = along `buildDir`), mm. */
  size: Vec3;
  bed?: { fits: boolean; /** Fits after turning 90° about the build axis. */ rotated: boolean };
  /** Total surface area, mm². */
  area: number;
  /** Human-readable problems (empty = looks printable). */
  warnings: string[];
  millis: number;
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!l) throw new RangeError("buildDir must not be zero");
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Check a mesh for 3D printing: overhangs steeper than `maxOverhangDeg`, walls thinner than
 * `minWall` (ray casts inward from every triangle), bed fit and tiny dimensions.
 * @example checkPrintability(await kernel.mesh("bracket"), { minWall: 0.8, bed: [220, 220, 250] })
 */
export function checkPrintability(mesh: CheckMesh, o: PrintabilityOptions = {}): PrintabilityResult {
  const t0 = performance.now();
  const up = norm(o.buildDir ?? [0, 0, 1]);
  const maxDeg = o.maxOverhangDeg ?? 45;
  const minWall = o.minWall ?? 0.8;
  const { normals, areas, centroids } = triangleNormals(mesh);
  const nt = areas.length;
  const P = mesh.positions;

  // build frame: u, v square to `up`
  const helper: Vec3 = Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm([helper[1] * up[2] - helper[2] * up[1], helper[2] * up[0] - helper[0] * up[2], helper[0] * up[1] - helper[1] * up[0]]);
  const v: Vec3 = [up[1] * u[2] - up[2] * u[1], up[2] * u[0] - up[0] * u[2], up[0] * u[1] - up[1] * u[0]];
  let hMin = Infinity, hMax = -Infinity, uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!;
    const h = x * up[0] + y * up[1] + z * up[2], a = x * u[0] + y * u[1] + z * u[2], b = x * v[0] + y * v[1] + z * v[2];
    if (h < hMin) hMin = h; if (h > hMax) hMax = h;
    if (a < uMin) uMin = a; if (a > uMax) uMax = a;
    if (b < vMin) vMin = b; if (b > vMax) vMax = b;
  }
  const size: Vec3 = up[2] > 0.999 ? (() => { const [lo, hi] = meshBounds(mesh); return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] as Vec3; })() : [uMax - uMin, vMax - vMin, hMax - hMin];
  const bedTol = o.bedTolerance ?? 0.01;

  // overhangs: downward faces steeper than the limit, not resting on the bed
  const limit = Math.sin((maxDeg * Math.PI) / 180); // dot(n, −up) above this = too steep
  const severity = new Float32Array(nt);
  const over: number[] = [];
  let overArea = 0, total = 0;
  const byFace = new Map<number, OverhangFace>();
  for (let t = 0; t < nt; t++) {
    total += areas[t]!;
    const down = -(normals[3 * t]! * up[0] + normals[3 * t + 1]! * up[1] + normals[3 * t + 2]! * up[2]);
    if (down <= limit + 1e-6) continue; // float32 meshes: exactly-at-the-limit faces pass
    // on the bed? (every vertex at the lowest height)
    let onBed = true;
    for (let k = 0; k < 3; k++) {
      const vi = mesh.indices[3 * t + k]! * 3;
      const h = P[vi]! * up[0] + P[vi + 1]! * up[1] + P[vi + 2]! * up[2];
      if (h - hMin > bedTol) onBed = false;
    }
    if (onBed) continue;
    const angle = (Math.asin(Math.min(1, down)) * 180) / Math.PI; // from vertical
    severity[t] = Math.max(1e-6, Math.min(1, (angle - maxDeg) / (90 - maxDeg)));
    over.push(t);
    overArea += areas[t]!;
    const fid = mesh.faceIds ? mesh.faceIds[t]! : -1;
    const f = byFace.get(fid) ?? { faceId: fid, area: 0, maxAngle: 0 };
    f.area += areas[t]!;
    f.maxAngle = Math.max(f.maxAngle, angle);
    byFace.set(fid, f);
  }

  const warnings: string[] = [];
  let thickness: PrintabilityResult["thickness"];
  if (!o.skipThickness && nt) {
    const bvh = buildBvh(P, mesh.indices);
    const byTriangle = new Float32Array(nt).fill(Infinity);
    const nv = P.length / 3;
    const byVertex = new Float32Array(nv).fill(Infinity);
    const diag = Math.hypot(size[0], size[1], size[2]);
    const eps = Math.max(1e-6, diag * 1e-7);
    let min = Infinity, thinArea = 0;
    const thin: number[] = [];
    const origin = [0, 0, 0], dir = [0, 0, 0];
    for (let t = 0; t < nt; t++) {
      if (!areas[t]) continue;
      const d0 = -normals[3 * t]!, d1 = -normals[3 * t + 1]!, d2 = -normals[3 * t + 2]!;
      dir[0] = d0; dir[1] = d1; dir[2] = d2;
      origin[0] = centroids[3 * t]! + d0 * eps; origin[1] = centroids[3 * t + 1]! + d1 * eps; origin[2] = centroids[3 * t + 2]! + d2 * eps;
      // the far wall: a triangle facing away from the ray's start (its normal along the ray)
      const hit = raycast(bvh, origin, dir, 0, Infinity, (tri) => tri !== t && normals[3 * tri]! * d0 + normals[3 * tri + 1]! * d1 + normals[3 * tri + 2]! * d2 > 0);
      if (!hit) continue;
      const d = hit.t + eps;
      byTriangle[t] = d;
      if (d < min) min = d;
      if (d < minWall) {
        thinArea += areas[t]!;
        thin.push(t);
      }
      for (let k = 0; k < 3; k++) {
        const vi = mesh.indices[3 * t + k]!;
        if (d < byVertex[vi]!) byVertex[vi] = d;
      }
    }
    thickness = { byTriangle, byVertex, min, thinArea, thinFraction: total ? thinArea / total : 0, thinTriangles: Uint32Array.from(thin) };
    if (thin.length) warnings.push(`walls thinner than ${minWall} mm over ${thinArea.toFixed(1)} mm² (thinnest ${min.toFixed(2)} mm)`);
  }

  let bed: PrintabilityResult["bed"];
  if (o.bed) {
    const [bx, by, bz] = o.bed;
    const straight = size[0] <= bx && size[1] <= by && size[2] <= bz;
    const turned = size[1] <= bx && size[0] <= by && size[2] <= bz;
    bed = { fits: straight || turned, rotated: !straight && turned };
    if (!bed.fits) warnings.push(`${size.map((s) => s.toFixed(1)).join(" × ")} mm does not fit the ${o.bed.join(" × ")} mm build volume`);
  }
  if (overArea > 0) warnings.push(`${overArea.toFixed(1)} mm² overhangs steeper than ${maxDeg}° (${((overArea / (total || 1)) * 100).toFixed(1)} % of the surface) — needs supports or a different orientation`);
  const smallest = Math.min(...size);
  if (smallest < minWall) warnings.push(`the part is only ${smallest.toFixed(2)} mm thick along one axis (< ${minWall} mm)`);

  return {
    overhang: {
      area: overArea,
      fraction: total ? overArea / total : 0,
      triangles: Uint32Array.from(over),
      severity,
      faces: [...byFace.values()].sort((a, b) => b.area - a.area),
    },
    ...(thickness ? { thickness } : {}),
    size,
    ...(bed ? { bed } : {}),
    area: total,
    warnings,
    millis: performance.now() - t0,
  };
}
