import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { unzlibSync } from "fflate";
import { loadKernel } from "../src/kernel";
import { crc32, renderImage, renderPNG, type RenderPart } from "../src/render";

/** A hand-built unit box mesh (independent of the kernel, so its render is fully deterministic). */
function boxPart(size: [number, number, number], color = "#4f7cac"): RenderPart {
  const [X, Y, Z] = size;
  const faces: [number[], number[][]][] = [
    [[0, 0, -1], [[0, 0, 0], [0, Y, 0], [X, Y, 0], [X, 0, 0]]],
    [[0, 0, 1], [[0, 0, Z], [X, 0, Z], [X, Y, Z], [0, Y, Z]]],
    [[0, -1, 0], [[0, 0, 0], [X, 0, 0], [X, 0, Z], [0, 0, Z]]],
    [[0, 1, 0], [[0, Y, 0], [0, Y, Z], [X, Y, Z], [X, Y, 0]]],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, Z], [0, Y, Z], [0, Y, 0]]],
    [[1, 0, 0], [[X, 0, 0], [X, Y, 0], [X, Y, Z], [X, 0, Z]]],
  ];
  const pos: number[] = [], nor: number[] = [], idx: number[] = [], edgePoints: number[] = [], edgeCounts: number[] = [];
  for (const [n, q] of faces) {
    const b = pos.length / 3;
    for (const p of q) pos.push(...p), nor.push(...n);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const c = (x: number, y: number, z: number) => [x * X, y * Y, z * Z];
  const edges = [
    [c(0, 0, 0), c(1, 0, 0)], [c(1, 0, 0), c(1, 1, 0)], [c(1, 1, 0), c(0, 1, 0)], [c(0, 1, 0), c(0, 0, 0)],
    [c(0, 0, 1), c(1, 0, 1)], [c(1, 0, 1), c(1, 1, 1)], [c(1, 1, 1), c(0, 1, 1)], [c(0, 1, 1), c(0, 0, 1)],
    [c(0, 0, 0), c(0, 0, 1)], [c(1, 0, 0), c(1, 0, 1)], [c(1, 1, 0), c(1, 1, 1)], [c(0, 1, 0), c(0, 1, 1)],
  ];
  for (const [a, b] of edges) edgePoints.push(...a!, ...b!), edgeCounts.push(2);
  return {
    name: "box",
    color,
    mesh: {
      positions: new Float32Array(pos),
      normals: new Float32Array(nor),
      indices: new Uint32Array(idx),
      edgePoints: new Float32Array(edgePoints),
      edgeCounts: new Uint32Array(edgeCounts),
    },
  };
}

/** Parse PNG chunks and check every CRC. */
function chunks(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array }[] = [];
  let o = 8;
  while (o < png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const data = png.subarray(o + 8, o + 8 + len);
    expect(dv.getUint32(o + 8 + len)).toBe((crc32(png.subarray(o + 4, o + 8 + len)) ^ 0xffffffff) >>> 0);
    out.push({ type, data });
    o += 12 + len;
  }
  return out;
}

const PINNED = "124f4f48790b8498a2d8b4c79687e6332737d5cb65ba0dd45910f2c5fa88981a";

describe("renderPNG", () => {
  test("PNG signature, IHDR, IDAT size, IEND", () => {
    const png = renderPNG([boxPart([20, 10, 8])], { width: 160, height: 100 });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const cs = chunks(png);
    expect(cs.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const ihdr = new DataView(cs[0]!.data.buffer, cs[0]!.data.byteOffset, 13);
    expect(ihdr.getUint32(0)).toBe(160);
    expect(ihdr.getUint32(4)).toBe(100);
    expect(cs[0]!.data[8]).toBe(8);
    expect(cs[0]!.data[9]).toBe(2); // RGB
    expect(unzlibSync(cs[1]!.data).length).toBe((160 * 3 + 1) * 100);
  });

  test("transparent background is RGBA", () => {
    const png = renderPNG([boxPart([20, 10, 8])], { width: 64, height: 48, background: "transparent" });
    const ihdr = chunks(png)[0]!.data;
    expect(ihdr[9]).toBe(6);
  });

  test("deterministic output", () => {
    const a = renderPNG([boxPart([20, 10, 8])], { width: 200, height: 140 });
    const b = renderPNG([boxPart([20, 10, 8])], { width: 200, height: 140 });
    const hash = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");
    expect(hash(a)).toBe(hash(b));
    // Pinned: a change here means the look changed — re-render docs/images and update the hash.
    expect(hash(a)).toBe(PINNED);
    expect(hash(a)).not.toBe(hash(renderPNG([boxPart([20, 10, 8])], { width: 200, height: 140, view: "top" })));
  });

  test("the model fills the frame and is coloured", () => {
    const img = renderImage([boxPart([30, 30, 30], "#ff0000")], { width: 200, height: 200, view: "iso" });
    let covered = 0, reddish = 0;
    const bg = [...img.data.subarray(0, 3)];
    for (let i = 0; i < img.data.length; i += 4) {
      const [r, g, b] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
      if (Math.abs(r - bg[0]!) + Math.abs(g - bg[1]!) + Math.abs(b - bg[2]!) > 40) covered++;
      if (r > 2 * g && r > 2 * b && r > 80) reddish++;
    }
    const n = img.width * img.height;
    expect(covered / n).toBeGreaterThan(0.3);
    expect(covered / n).toBeLessThan(0.9);
    expect(reddish / n).toBeGreaterThan(0.25);
  });

  test("top view of a box is a filled rectangle with dark outlines", () => {
    const img = renderImage([boxPart([40, 20, 5], "#ffffff")], { width: 200, height: 200, view: "top", projection: "orthographic", shadow: false, margin: 0.1 });
    const px = (x: number, y: number) => [...img.data.subarray(4 * (y * 200 + x), 4 * (y * 200 + x) + 3)];
    // centre is the bright top face, the very border is background
    expect(Math.min(...px(100, 100))).toBeGreaterThan(150);
    expect(Math.max(...px(2, 2))).toBeLessThan(60);
    // the box spans 160 px wide (80% of the width) and 80 px tall
    const row = Array.from({ length: 200 }, (_, x) => Math.min(...px(x, 100)) > 120);
    const width = row.filter(Boolean).length;
    expect(width).toBeGreaterThan(150);
    expect(width).toBeLessThan(162);
  });

  test("renders a kernel mesh", async () => {
    const kernel = await loadKernel();
    await kernel.evaluate({
      parts: [{ name: "r", color: "orange", node: { type: "fillet", radius: 2, edges: { type: "parallel", axis: "z" }, children: [{ type: "box", size: [30, 20, 10] }] } }],
    });
    const png = renderPNG([{ name: "r", color: "orange", mesh: await kernel.meshAt("r", 0.05) }], { width: 240, height: 160, background: "light" });
    expect(png.length).toBeGreaterThan(1000);
    expect(chunks(png).length).toBe(3);
  });

  test("empty input renders a background", () => {
    const img = renderImage([], { width: 32, height: 16 });
    expect(img.data.length).toBe(32 * 16 * 4);
  });
});
