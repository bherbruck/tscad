import { describe, expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { exportModel, toGLB, toOBJ, toSTL, to3MF } from "../src/export";
import { parseColor, toHex } from "../src/export/color";
import { weld } from "../src/export/mesh";
import { docs, evaluated, meshVolume, openEdges, parseBinarySTL } from "./export.helpers";

const TOL = 0.01;

async function partsOf(doc: (typeof docs)[keyof typeof docs]) {
  const { kernel, volumes } = await evaluated(doc);
  const parts = [];
  for (const p of doc.parts) parts.push({ name: p.name, color: (p as { color?: string }).color, mesh: await kernel.meshAt(p.name, TOL) });
  return { kernel, volumes, parts };
}

describe("STL", () => {
  for (const name of ["box", "filleted", "assembly"] as const) {
    test(`binary ${name}: size, count, watertight, volume`, async () => {
      const { parts, volumes } = await partsOf(docs[name]);
      const stl = toSTL(parts);
      const tris = parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
      expect(stl.byteLength).toBe(84 + 50 * tris);
      expect(new TextDecoder().decode(stl.subarray(0, 5))).not.toBe("solid");
      const soup = parseBinarySTL(stl);
      expect(soup.count).toBe(tris);
      expect(openEdges(soup.positions, soup.indices)).toBe(0);
      const expected = Object.values(volumes).reduce((a, b) => a + b, 0);
      expect(Math.abs(meshVolume(soup.positions, soup.indices) - expected) / expected).toBeLessThan(0.01);
    });
  }

  test("ascii", async () => {
    const { parts } = await partsOf(docs.box);
    const text = new TextDecoder().decode(toSTL(parts, { binary: false }));
    expect(text.startsWith("solid block\n")).toBe(true);
    expect(text.trimEnd().endsWith("endsolid block")).toBe(true);
    expect(text.match(/facet normal/g)!.length).toBe(parts[0]!.mesh.indices.length / 3);
    expect(text.match(/^\s+vertex /gm)!.length).toBe(parts[0]!.mesh.indices.length);
  });

  test("box volume is exact", async () => {
    const { parts } = await partsOf(docs.box);
    const s = parseBinarySTL(toSTL(parts));
    expect(meshVolume(s.positions, s.indices)).toBeCloseTo(1000, 3);
  });
});

describe("3MF", () => {
  test("package structure, counts, colours", async () => {
    const { parts, volumes } = await partsOf(docs.assembly);
    const files = unzipSync(to3MF(parts));
    expect(Object.keys(files).sort()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain("application/vnd.ms-package.3dmanufacturing-3dmodel+xml");
    expect(strFromU8(files["_rels/.rels"]!)).toContain('Target="/3D/3dmodel.model"');
    const xml = strFromU8(files["3D/3dmodel.model"]!);
    expect(xml).toContain('unit="millimeter"');
    expect(xml).toContain('displaycolor="#FFA500"'); // orange
    expect(xml).toContain('displaycolor="#C8C8D2"'); // rgb(200, 200, 210)
    expect(xml.match(/<item objectid=/g)!.length).toBe(3);
    const objects = xml.split("<object ").slice(1);
    expect(objects.length).toBe(3);
    objects.forEach((obj, i) => {
      const w = weld(parts[i]!.mesh);
      const verts = [...obj.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].flatMap((m) => [+m[1]!, +m[2]!, +m[3]!]);
      const tris = [...obj.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].flatMap((m) => [+m[1]!, +m[2]!, +m[3]!]);
      expect(verts.length).toBe(w.positions.length);
      expect(tris.length).toBe(w.indices.length);
      expect(Math.max(...tris)).toBeLessThan(verts.length / 3);
      // A 3MF object must be a closed, consistently oriented mesh.
      expect(openEdges(verts, tris)).toBe(0);
      const vol = volumes[parts[i]!.name]!;
      expect(Math.abs(meshVolume(verts, tris) - vol) / vol).toBeLessThan(0.01);
    });
  });
});

describe("GLB", () => {
  test("header, chunks, accessors", async () => {
    const { parts } = await partsOf(docs.assembly);
    const glb = toGLB(parts);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
    const jsonLen = dv.getUint32(12, true);
    expect(jsonLen % 4).toBe(0);
    expect(dv.getUint32(16, true)).toBe(0x4e4f534a);
    const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
    const binLen = dv.getUint32(20 + jsonLen, true);
    expect(dv.getUint32(24 + jsonLen, true)).toBe(0x004e4942);
    expect(28 + jsonLen + binLen).toBe(glb.byteLength);
    expect(gltf.buffers[0].byteLength).toBe(binLen);
    expect(gltf.meshes.length).toBe(3);
    expect(gltf.nodes.length).toBe(4);
    expect(gltf.nodes[0].children).toEqual([1, 2, 3]);
    expect(gltf.materials.length).toBe(3);
    const bin = glb.subarray(28 + jsonLen);
    parts.forEach((part, i) => {
      const prim = gltf.meshes[i].primitives[0];
      const pos = gltf.accessors[prim.attributes.POSITION];
      expect(pos.count).toBe(part.mesh.positions.length / 3);
      expect(gltf.accessors[prim.attributes.NORMAL].count).toBe(pos.count);
      const ind = gltf.accessors[prim.indices];
      expect(ind.count).toBe(part.mesh.indices.length);
      expect(ind.componentType).toBe(5125);
      const bv = gltf.bufferViews[pos.bufferView];
      expect(bv.byteOffset % 4).toBe(0);
      const back = new Float32Array(bin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength).buffer);
      expect(Array.from(back)).toEqual(Array.from(part.mesh.positions));
      expect(pos.min.length).toBe(3);
    });
  });
});

describe("OBJ", () => {
  test("groups and counts", async () => {
    const { parts } = await partsOf(docs.assembly);
    const obj = toOBJ(parts);
    expect(obj.match(/^o /gm)!.length).toBe(3);
    const nv = parts.reduce((n, p) => n + p.mesh.positions.length / 3, 0);
    const nf = parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
    expect(obj.match(/^v /gm)!.length).toBe(nv);
    expect(obj.match(/^vn /gm)!.length).toBe(nv);
    expect(obj.match(/^f /gm)!.length).toBe(nf);
    const maxIndex = Math.max(...[...obj.matchAll(/^f (\d+)\/\/\d+ (\d+)\/\/\d+ (\d+)/gm)].flatMap((m) => [+m[1]!, +m[2]!, +m[3]!]));
    expect(maxIndex).toBe(nv);
  });
});

describe("exportModel", () => {
  test("every format", async () => {
    const { kernel } = await evaluated(docs.filleted);
    const parts = [{ name: "plate", color: "#3a7bd5" }];
    const step = await exportModel(kernel, parts, "step");
    expect(typeof step).toBe("string");
    expect((step as string).startsWith("ISO-10303-21")).toBe(true);
    expect((await exportModel(kernel, parts, "stl")) instanceof Uint8Array).toBe(true);
    expect((await exportModel(kernel, parts, "3mf")) instanceof Uint8Array).toBe(true);
    expect((await exportModel(kernel, parts, "glb")) instanceof Uint8Array).toBe(true);
    expect(typeof (await exportModel(kernel, parts, "obj"))).toBe("string");
    const coarse = (await exportModel(kernel, parts, "stl", { tolerance: 0.5 })) as Uint8Array;
    const fine = (await exportModel(kernel, parts, "stl")) as Uint8Array;
    expect(coarse.byteLength).toBeLessThan(fine.byteLength);
  });
});

describe("colours", () => {
  test("CSS parsing", () => {
    expect(toHex(parseColor("tomato")!)).toBe("#FF6347");
    expect(toHex(parseColor("#abc")!)).toBe("#AABBCC");
    expect(toHex(parseColor("#11223344")!)).toBe("#11223344");
    expect(toHex(parseColor("rgb(255 0 0)")!)).toBe("#FF0000");
    expect(toHex(parseColor("hsl(120, 100%, 50%)")!)).toBe("#00FF00");
    expect(parseColor("nonsense")).toBeUndefined();
  });
});
