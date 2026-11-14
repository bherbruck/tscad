/** Wavefront OBJ writer: one `o` group per part, with vertex normals. */
import { type ExportPart, fmt } from "./mesh";

export function toOBJ(parts: ExportPart[]): string {
  const lines = ["# tscad OBJ export (millimetres, Z up)"];
  let base = 1;
  for (const { name, mesh } of parts) {
    const { positions: p, normals: n, indices: idx } = mesh;
    const hasNormals = n.length === p.length;
    lines.push(`o ${name.replace(/\s+/g, "_")}`);
    for (let i = 0; i < p.length; i += 3) lines.push(`v ${fmt(p[i]!)} ${fmt(p[i + 1]!)} ${fmt(p[i + 2]!)}`);
    if (hasNormals) for (let i = 0; i < n.length; i += 3) lines.push(`vn ${fmt(n[i]!)} ${fmt(n[i + 1]!)} ${fmt(n[i + 2]!)}`);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! + base, b = idx[t + 1]! + base, c = idx[t + 2]! + base;
      lines.push(hasNormals ? `f ${a}//${a} ${b}//${b} ${c}//${c}` : `f ${a} ${b} ${c}`);
    }
    base += p.length / 3;
  }
  lines.push("");
  return lines.join("\n");
}
