/** Mesh helpers shared by the exporters. */
import type { MeshArrays } from "../kernel";

/** One exported part: a name, an optional CSS colour, and its triangle mesh (millimetres, Z up). */
export type ExportPart = { name: string; color?: string; mesh: MeshArrays };

/** An indexed mesh with coincident positions merged (for formats that want shared vertices). */
export interface WeldedMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Merge vertices that sit at exactly the same position (the kernel splits vertices along face
 * boundaries for flat shading), and drop triangles that collapse.
 */
export function weld(mesh: Pick<MeshArrays, "positions" | "indices">): WeldedMesh {
  const { positions, indices } = mesh;
  const n = positions.length / 3;
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  const map = new Map<string, number>();
  const remap = new Uint32Array(n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Normalise -0 to 0 so it welds with +0.
    const key = `${bits[3 * i]! === 0x80000000 ? 0 : bits[3 * i]},${bits[3 * i + 1]! === 0x80000000 ? 0 : bits[3 * i + 1]},${bits[3 * i + 2]! === 0x80000000 ? 0 : bits[3 * i + 2]}`;
    let j = map.get(key);
    if (j === undefined) {
      j = out.length / 3;
      map.set(key, j);
      out.push(positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!);
    }
    remap[i] = j;
  }
  const tris: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]!]!, b = remap[indices[t + 1]!]!, c = remap[indices[t + 2]!]!;
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { positions: new Float32Array(out), indices: new Uint32Array(tris) };
}

/** Number formatting for text formats: shortest round-trip of the float32 value. */
export function fmt(v: number): string {
  if (Object.is(v, -0) || v === 0) return "0";
  return String(Math.fround(v));
}

/** Escape text for an XML attribute. */
export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export const encoder = new TextEncoder();
