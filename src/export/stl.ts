/** STL writer (binary by default, ASCII on request). */
import { type ExportPart, encoder, fmt } from "./mesh";

function triangles(parts: ExportPart[]): number {
  return parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
}

function facetNormal(p: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ux = p[3 * b]! - p[3 * a]!, uy = p[3 * b + 1]! - p[3 * a + 1]!, uz = p[3 * b + 2]! - p[3 * a + 2]!;
  const vx = p[3 * c]! - p[3 * a]!, vy = p[3 * c + 1]! - p[3 * a + 1]!, vz = p[3 * c + 2]! - p[3 * a + 2]!;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** All parts as one STL solid (binary: 80-byte header, count, 50 bytes per triangle). */
export function toSTL(parts: ExportPart[], opts: { binary?: boolean } = {}): Uint8Array {
  return opts.binary === false ? encoder.encode(asciiSTL(parts)) : binarySTL(parts);
}

function binarySTL(parts: ExportPart[]): Uint8Array {
  const count = triangles(parts);
  const out = new Uint8Array(84 + 50 * count);
  const view = new DataView(out.buffer);
  const header = encoder.encode(`tscad STL: ${parts.map((p) => p.name).join(", ")}`.slice(0, 80));
  // A binary STL header must not start with "solid" (some readers then parse it as ASCII).
  out.set(header.subarray(0, 80));
  view.setUint32(80, count, true);
  let o = 84;
  for (const { mesh } of parts) {
    const p = mesh.positions, idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
      const n = facetNormal(p, a, b, c);
      view.setFloat32(o, n[0], true);
      view.setFloat32(o + 4, n[1], true);
      view.setFloat32(o + 8, n[2], true);
      o += 12;
      for (const v of [a, b, c]) {
        view.setFloat32(o, p[3 * v]!, true);
        view.setFloat32(o + 4, p[3 * v + 1]!, true);
        view.setFloat32(o + 8, p[3 * v + 2]!, true);
        o += 12;
      }
      o += 2; // attribute byte count
    }
  }
  return out;
}

function asciiSTL(parts: ExportPart[]): string {
  const name = (parts.length === 1 ? parts[0]!.name : "tscad").replace(/\s+/g, "_");
  const lines = [`solid ${name}`];
  for (const { mesh } of parts) {
    const p = mesh.positions, idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
      const n = facetNormal(p, a, b, c);
      lines.push(`  facet normal ${fmt(n[0])} ${fmt(n[1])} ${fmt(n[2])}`, "    outer loop");
      for (const v of [a, b, c]) lines.push(`      vertex ${fmt(p[3 * v]!)} ${fmt(p[3 * v + 1]!)} ${fmt(p[3 * v + 2]!)}`);
      lines.push("    endloop", "  endfacet");
    }
  }
  lines.push(`endsolid ${name}`, "");
  return lines.join("\n");
}
