/**
 * Print-ready plates: turn each part to the orientation with the least overhang (axis directions
 * and its largest flat faces as candidate bottoms), drop it onto z = 0, and pack every part (and
 * copy) onto build plates. Pure TypeScript over kernel meshes: the CLI, the viewer and the MCP
 * server share it.
 */
import { checkPrintability } from "../check";
import { zipSync } from "fflate";
import { threeMFModel } from "../export/threemf";
import type { ExportPart } from "../export/mesh";
import type { MeshArrays } from "../kernel";

type V3 = [number, number, number];
/** Row-major 4×4 (column vectors), like the IR. */
export type Mat4 = number[];

export interface PlateInput {
  name: string;
  color?: string;
  mesh: Pick<MeshArrays, "positions" | "indices"> & Partial<Pick<MeshArrays, "normals" | "faceIds">>;
  /** How many to print. Default 1. */
  copies?: number;
}

export interface OrientationChoice {
  /** The part-space direction that ends up pointing down (−Z). */
  down: V3;
  /** Human: "−Z (as modelled)", "+Y", "face 12". */
  label: string;
  /** Rotation (row-major 4×4) that takes the part to this orientation (before the drop). */
  rotation: Mat4;
  overhangArea: number;
  /** Overhang area / surface area. */
  overhangFraction: number;
  /** Area of the faces resting on the bed, mm². */
  contactArea: number;
  /** Height above the bed, mm. */
  height: number;
}

export interface Placed {
  name: string;
  /** 1 for the first copy. */
  copy: number;
  color?: string;
  /** 0-based plate. */
  plate: number;
  /** Row-major 4×4 from the part's model space to its spot on the plate (z = 0 bottom). */
  transform: Mat4;
  orientation: OrientationChoice;
  /** Footprint on the plate (after the 90° turn, when taken): x, y, width, depth, mm. */
  rect: [number, number, number, number];
  rotated90: boolean;
}

export interface PlateOptions {
  /** Bed size x, y, mm. Default 256 × 256. */
  bed?: [number, number];
  /** Gap between parts and from the bed's edge, mm. Default 5. */
  spacing?: number;
  /** "auto" picks the least-overhang orientation; "keep" prints as modelled. Default "auto". */
  orient?: "auto" | "keep";
  /** Max overhang angle from vertical for the overhang measure, degrees. Default 45. */
  maxOverhangDeg?: number;
}

export interface PlateResult {
  plates: number;
  bed: [number, number];
  items: Placed[];
}

// ───────────────────────── small linear algebra ─────────────────────────

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const I4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul4(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k]! * b[k * 4 + c]!;
  return o;
}

export function apply4(m: Mat4, p: V3): V3 {
  return [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!, m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!, m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!];
}

const translate = (x: number, y: number, z: number): Mat4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const rotZ90: Mat4 = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The rotation taking unit vector `d` to −Z (shortest arc; a half turn about X for d = +Z). */
export function rotationToDown(d: V3): Mat4 {
  const a = norm(d), b: V3 = [0, 0, -1];
  const c = dot(a, b);
  if (c > 1 - 1e-12) return [...I4];
  if (c < -1 + 1e-12) return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  const v = cross(a, b);
  const k = 1 / (1 + c);
  // Rodrigues: R = I + [v]× + [v]×² / (1 + c)
  return [
    1 - k * (v[1] * v[1] + v[2] * v[2]), k * v[0] * v[1] - v[2], k * v[0] * v[2] + v[1], 0,
    k * v[0] * v[1] + v[2], 1 - k * (v[0] * v[0] + v[2] * v[2]), k * v[1] * v[2] - v[0], 0,
    k * v[0] * v[2] - v[1], k * v[1] * v[2] + v[0], 1 - k * (v[0] * v[0] + v[1] * v[1]), 0,
    0, 0, 0, 1,
  ];
}

function transformPositions(p: ArrayLike<number>, m: Mat4): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const q = apply4(m, [p[i]!, p[i + 1]!, p[i + 2]!]);
    out[i] = q[0];
    out[i + 1] = q[1];
    out[i + 2] = q[2];
  }
  return out;
}

function bounds(p: ArrayLike<number>): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p[i + k]!;
    if (v < lo[k]!) lo[k] = v;
    if (v > hi[k]!) hi[k] = v;
  }
  return [lo, hi];
}

// ───────────────────────── orientation ─────────────────────────

const AXES: [V3, string][] = [
  [[0, 0, -1], "−Z (as modelled)"],
  [[0, 0, 1], "+Z"],
  [[1, 0, 0], "+X"],
  [[-1, 0, 0], "−X"],
  [[0, 1, 0], "+Y"],
  [[0, -1, 0], "−Y"],
];

/** The largest flat regions (by summed triangle area per normal), as candidate bottoms. */
function flatFaceDirections(mesh: PlateInput["mesh"], count: number): { d: V3; area: number; face?: number }[] {
  const P = mesh.positions, I = mesh.indices;
  const groups = new Map<string, { n: V3; area: number; face?: number }>();
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const u: V3 = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
    const v: V3 = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!];
    const n = cross(u, v);
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12) continue;
    const nn: V3 = [n[0] / l, n[1] / l, n[2] / l];
    // Quantise the normal: triangles of one flat face share it.
    const key = nn.map((x) => Math.round(x * 2000)).join(",");
    const g = groups.get(key) ?? { n: nn, area: 0, face: mesh.faceIds?.[t / 3] };
    g.area += l / 2;
    groups.set(key, g);
  }
  return [...groups.values()].sort((x, y) => y.area - x.area).slice(0, count).map((g) => ({ d: g.n, area: g.area, face: g.face }));
}

/** Score every candidate orientation of `mesh` and return them best first. */
export function orientationCandidates(mesh: PlateInput["mesh"], opts: { maxOverhangDeg?: number } = {}): OrientationChoice[] {
  const cands: { d: V3; label: string }[] = AXES.map(([d, label]) => ({ d, label }));
  for (const f of flatFaceDirections(mesh, 6)) {
    if (cands.some((c) => dot(c.d, f.d) > Math.cos((1 * Math.PI) / 180))) continue;
    cands.push({ d: f.d, label: `face ${f.face ?? "?"}` });
  }
  const out: OrientationChoice[] = [];
  for (const c of cands) {
    const rotation = rotationToDown(c.d);
    const positions = transformPositions(mesh.positions, rotation);
    const pr = checkPrintability({ positions, indices: mesh.indices }, { maxOverhangDeg: opts.maxOverhangDeg ?? 45, skipThickness: true });
    const [lo, hi] = bounds(positions);
    out.push({ down: c.d, label: c.label, rotation, overhangArea: pr.overhang.area, overhangFraction: pr.overhang.fraction, contactArea: contactArea(positions, mesh.indices, lo[2]), height: hi[2] - lo[2] });
  }
  const total = out[0] ? out[0].overhangArea / Math.max(out[0].overhangFraction, 1e-12) : 1;
  const tol = Math.max(1, total * 0.005); // overhang within 0.5 % of the surface counts as a tie
  return out.sort((a, b) => {
    if (Math.abs(a.overhangArea - b.overhangArea) > tol) return a.overhangArea - b.overhangArea;
    if (Math.abs(a.contactArea - b.contactArea) > tol) return b.contactArea - a.contactArea; // steadier
    return a.height - b.height;
  });
}

/** Area of the downward-facing triangles lying on the lowest plane. */
function contactArea(P: Float32Array, I: ArrayLike<number>, z0: number): number {
  let area = 0;
  const eps = 1e-3;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    if (Math.abs(P[a + 2]! - z0) > eps || Math.abs(P[b + 2]! - z0) > eps || Math.abs(P[c + 2]! - z0) > eps) continue;
    const u: V3 = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, 0], v: V3 = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, 0];
    area += Math.abs(cross(u, v)[2]) / 2;
  }
  return area;
}

// ───────────────────────── packing ─────────────────────────

export interface PackItem {
  key: number;
  w: number;
  h: number;
}

export interface PackPlacement {
  key: number;
  plate: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

/**
 * Shelf packing onto as many `bed`-sized plates as needed, `spacing` between parts and from the
 * edges; each item may turn 90° when that suits the shelf better. Throws when an item can't fit
 * a bed either way round.
 */
export function packRects(items: PackItem[], bed: [number, number], spacing: number): PackPlacement[] {
  const [BW, BH] = bed;
  const fitsBed = (w: number, h: number) => spacing + w + spacing <= BW + 1e-9 && spacing + h + spacing <= BH + 1e-9;
  for (const it of items) {
    if (!fitsBed(it.w, it.h) && !fitsBed(it.h, it.w)) throw new Error(`item ${it.key} (${it.w.toFixed(1)} × ${it.h.toFixed(1)} mm) doesn't fit a ${BW} × ${BH} mm bed with ${spacing} mm spacing`);
  }
  // Tallest (shorter side) first, then longest: shelves fill with similar heights.
  const order = [...items].sort((a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h));
  type Shelf = { y: number; h: number; x: number };
  const plates: { shelves: Shelf[]; top: number }[] = [];
  const out: PackPlacement[] = [];
  const ways = (it: PackItem) => [
    { w: it.w, h: it.h, rotated: false },
    { w: it.h, h: it.w, rotated: true },
  ];
  const put = (it: PackItem, p: number, s: Shelf, o: { w: number; h: number; rotated: boolean }) => {
    out.push({ key: it.key, plate: p, x: s.x, y: s.y, w: o.w, h: o.h, rotated: o.rotated });
    s.x += o.w + spacing;
  };
  const tryPlate = (it: PackItem, p: number): boolean => {
    const plate = plates[p]!;
    // 1. an existing shelf: the orientation that fits with the least wasted height
    for (const s of plate.shelves) {
      // The top shelf may grow taller while the bed has room above it.
      const last = s === plate.shelves[plate.shelves.length - 1];
      const maxH = last ? BH - spacing - s.y : s.h;
      const fit = ways(it)
        .filter((o) => o.h <= maxH + 1e-9 && s.x + o.w + spacing <= BW + 1e-9)
        .sort((a, b) => Math.max(0, a.h - s.h) - Math.max(0, b.h - s.h) || b.h - a.h || a.w - b.w)[0];
      if (fit) {
        if (fit.h > s.h) {
          plate.top += fit.h - s.h;
          s.h = fit.h;
        }
        return put(it, p, s, fit), true;
      }
    }
    // 2. a new shelf: long side along X first (lower shelves), else turned
    const long = it.w >= it.h ? ways(it)[0]! : ways(it)[1]!;
    for (const o of [long, { w: long.h, h: long.w, rotated: !long.rotated }]) {
      if (plate.top + o.h + spacing <= BH + 1e-9 && spacing + o.w + spacing <= BW + 1e-9) {
        const s: Shelf = { y: plate.top, h: o.h, x: spacing };
        plate.shelves.push(s);
        plate.top += o.h + spacing;
        return put(it, p, s, o), true;
      }
    }
    return false;
  };
  for (const it of order) {
    let done = false;
    for (let p = 0; p < plates.length && !done; p++) done = tryPlate(it, p);
    if (!done) {
      plates.push({ shelves: [], top: spacing });
      if (!tryPlate(it, plates.length - 1)) throw new Error(`item ${it.key} doesn't fit an empty plate`);
    }
  }
  return out;
}

// ───────────────────────── the whole thing ─────────────────────────

/** Orient every part, pack all copies, and give each copy its transform onto its plate. */
export function plateParts(parts: PlateInput[], opts: PlateOptions = {}): PlateResult {
  const bed = opts.bed ?? [256, 256];
  const spacing = opts.spacing ?? 5;
  const oriented = parts.map((p) => {
    const choice =
      opts.orient === "keep"
        ? (orientationCandidates(p.mesh, opts).find((c) => c.label.startsWith("−Z")) ?? orientationCandidates(p.mesh, opts)[0]!)
        : orientationCandidates(p.mesh, opts)[0]!;
    const rotated = transformPositions(p.mesh.positions, choice.rotation);
    const [lo, hi] = bounds(rotated);
    return { part: p, choice, lo, hi };
  });
  const items: PackItem[] = [];
  const owners: { i: number; copy: number }[] = [];
  oriented.forEach((o, i) => {
    for (let c = 1; c <= Math.max(1, o.part.copies ?? 1); c++) {
      owners.push({ i, copy: c });
      items.push({ key: owners.length - 1, w: o.hi[0] - o.lo[0], h: o.hi[1] - o.lo[1] });
    }
  });
  const placements = packRects(items, bed, spacing);
  const placed: Placed[] = placements
    .map((pl) => {
      const { i, copy } = owners[pl.key]!;
      const o = oriented[i]!;
      // Move the oriented part's footprint corner to the origin, turn it if packed turned, then place.
      let m = mul4(translate(-o.lo[0], -o.lo[1], -o.lo[2]), o.choice.rotation);
      if (pl.rotated) m = mul4(mul4(translate(o.hi[1] - o.lo[1], 0, 0), rotZ90), m);
      m = mul4(translate(pl.x, pl.y, 0), m);
      return {
        name: o.part.name,
        copy,
        color: o.part.color,
        plate: pl.plate,
        transform: m,
        orientation: o.choice,
        rect: [pl.x, pl.y, pl.w, pl.h] as [number, number, number, number],
        rotated90: pl.rotated,
      };
    })
    .sort((a, b) => a.plate - b.plate || a.name.localeCompare(b.name) || a.copy - b.copy);
  return { plates: Math.max(0, ...placed.map((p) => p.plate + 1)), bed, items: placed };
}

/** A mesh moved by `m` (positions and normals). */
export function transformMesh(mesh: MeshArrays, m: Mat4): MeshArrays {
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const n = norm([m[0]! * mesh.normals[i]! + m[1]! * mesh.normals[i + 1]! + m[2]! * mesh.normals[i + 2]!, m[4]! * mesh.normals[i]! + m[5]! * mesh.normals[i + 1]! + m[6]! * mesh.normals[i + 2]!, m[8]! * mesh.normals[i]! + m[9]! * mesh.normals[i + 1]! + m[10]! * mesh.normals[i + 2]!]);
    normals.set(n, i);
  }
  return { ...mesh, positions: transformPositions(mesh.positions, m), normals, edgePoints: transformPositions(mesh.edgePoints, m) };
}

/** A 3MF metadata note for one placed copy. */
export function orientationNote(p: Placed): string {
  return `bottom: ${p.orientation.label}; overhang ${(p.orientation.overhangFraction * 100).toFixed(1)}% (${p.orientation.overhangArea.toFixed(0)} mm²); height ${p.orientation.height.toFixed(1)} mm${p.rotated90 ? "; turned 90° on the plate" : ""}`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);

/** A 3MF of one plate: the exporter's model, with a metadata group per object (orientation, overhang). */
export function plate3MF(parts: ExportPart[], notes: string[], bed: [number, number]): Uint8Array {
  let model = threeMFModel(parts);
  model = model.replace(`<model unit="millimeter"`, `<model unit="millimeter" xmlns:tscad="https://github.com/bherbruck/tscad"`);
  model = model.replace(`<metadata name="Application">tscad</metadata>`, `<metadata name="Application">tscad</metadata>\n  <metadata name="tscad:bed">${bed[0]} x ${bed[1]} mm</metadata>`);
  parts.forEach((p, i) => {
    const open = new RegExp(`(<object id="${i + 2}"[^>]*>)`);
    model = model.replace(open, `$1\n      <metadatagroup>\n        <metadata name="tscad:orientation">${xml(notes[i] ?? "")}</metadata>\n      </metadatagroup>`);
  });
  const enc = new TextEncoder();
  return zipSync({ "[Content_Types].xml": enc.encode(CONTENT_TYPES), "_rels/.rels": enc.encode(RELS), "3D/3dmodel.model": enc.encode(model) }, { level: 6 });
}

