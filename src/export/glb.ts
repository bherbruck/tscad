/** glTF 2.0 binary writer: one mesh + node per part under a Z-up → Y-up root, mm → m. */
import { DEFAULT_COLOR, parseColor, srgbToLinear } from "./color";
import { type ExportPart, encoder } from "./mesh";

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_INT = 5125;

const pad4 = (n: number) => (n + 3) & ~3;

/** A GLB file. The root node rotates -90° about X (glTF is Y-up) and scales mm to metres. */
export function toGLB(parts: ExportPart[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const nodes: object[] = [{ name: "tscad", rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [0.001, 0.001, 0.001], children: parts.map((_, i) => i + 1) }];
  const materials: object[] = [];

  const view = (data: ArrayBufferView, target: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    const pad = pad4(byteLength) - byteLength;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    return bufferViews.length - 1;
  };

  parts.forEach((part, i) => {
    const { positions, normals, indices } = part.mesh;
    const count = positions.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < positions.length; v += 3) {
      for (let k = 0; k < 3; k++) {
        const x = positions[v + k]!;
        if (x < min[k]!) min[k] = x;
        if (x > max[k]!) max[k] = x;
      }
    }
    if (!count) min.fill(0), max.fill(0);
    accessors.push({ bufferView: view(positions, ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3", min, max });
    const attributes: Record<string, number> = { POSITION: accessors.length - 1 };
    if (normals.length === positions.length) {
      accessors.push({ bufferView: view(normals, ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3" });
      attributes.NORMAL = accessors.length - 1;
    }
    accessors.push({ bufferView: view(indices, ELEMENT_ARRAY_BUFFER), componentType: UNSIGNED_INT, count: indices.length, type: "SCALAR" });
    const c = parseColor(part.color) ?? DEFAULT_COLOR;
    materials.push({
      name: part.color ?? "default",
      pbrMetallicRoughness: { baseColorFactor: [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]), c[3] / 255], metallicFactor: 0.1, roughnessFactor: 0.6 },
      ...(c[3] < 255 ? { alphaMode: "BLEND" } : {}),
    });
    meshes.push({ name: part.name, primitives: [{ attributes, indices: accessors.length - 1, material: i, mode: 4 }] });
    nodes.push({ name: part.name, mesh: i });
  });

  const gltf = {
    asset: { version: "2.0", generator: "tscad" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  let json = encoder.encode(JSON.stringify(gltf));
  const jsonLen = pad4(json.byteLength);
  const total = 12 + 8 + jsonLen + 8 + byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(json, 20);
  out.fill(0x20, 20 + json.byteLength, 20 + jsonLen);
  let o = 20 + jsonLen;
  dv.setUint32(o, byteLength, true);
  dv.setUint32(o + 4, 0x004e4942, true); // "BIN\0"
  o += 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
