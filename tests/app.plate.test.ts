import { describe, expect, test } from "bun:test";
import { apply4, orientationCandidates, packRects, plateParts, rotationToDown } from "../src/plate";
import { createKernel, type MeshArrays } from "../src/kernel";
import type { Node } from "../src/ir";

const box = (x: number, y: number, z: number, at: [number, number, number] = [0, 0, 0]): Node => ({
  type: "transform",
  matrix: [1, 0, 0, at[0], 0, 1, 0, at[1], 0, 0, 1, at[2], 0, 0, 0, 1],
  children: [{ type: "box", size: [x, y, z] }],
});

async function meshOf(node: Node): Promise<MeshArrays> {
  const k = await createKernel();
  await k.evaluate({ parts: [{ name: "p", node }] });
  const m = (await k.mesh("p"))!;
  k.dispose();
  return m;
}

describe("orientation", () => {
  test("rotationToDown takes the direction to −Z", () => {
    for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.6, 0, 0.8]] as [number, number, number][]) {
      const q = apply4(rotationToDown(d), d);
      expect(q[0]).toBeCloseTo(0, 9);
      expect(q[1]).toBeCloseTo(0, 9);
      expect(q[2]).toBeCloseTo(-1, 9);
    }
  });

  test("a T standing on its stem is flipped onto its crossbar (no overhang)", async () => {
    // stem 10×10×30, crossbar 50×10×8 on top: as modelled the crossbar overhangs.
    const t: Node = { type: "union", children: [box(10, 10, 30, [20, 0, 0]), box(50, 10, 8, [0, 0, 30])] };
    const c = orientationCandidates(await meshOf(t));
    const asModelled = c.find((x) => x.label.startsWith("−Z"))!;
    expect(asModelled.overhangArea).toBeGreaterThan(300);
    // Best: crossbar down (+Z down) or on its side (±Y): no overhang either way; the crossbar
    // face wins the tie on contact area… unless a side gives the same overhang with more contact.
    expect(c[0]!.overhangArea).toBeLessThan(1);
    expect(c[0]!.contactArea).toBeGreaterThanOrEqual(400); // ≥ the 50×10 crossbar top
  }, 30_000);

  test("an L bracket modelled on its base stays base-down", async () => {
    // base 60×40×5, upright 60×5×40 at the back: as modelled no overhang, biggest contact.
    const l: Node = { type: "union", children: [box(60, 40, 5), box(60, 5, 40, [0, 35, 0])] };
    const c = orientationCandidates(await meshOf(l));
    expect(c[0]!.overhangArea).toBeLessThan(1);
    // ties broken by contact area: the 60×40 base (or the 60×40 upright's back) on the bed
    expect(c[0]!.contactArea).toBeCloseTo(2400, 0);
  }, 30_000);
});

describe("packing", () => {
  const overlaps = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;

  test("never overlaps, keeps the spacing and stays on the bed", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ key: i, w: 10 + ((i * 37) % 50), h: 8 + ((i * 53) % 40) }));
    const bed: [number, number] = [200, 180];
    const s = 4;
    const p = packRects(items, bed, s);
    expect(p.length).toBe(items.length);
    for (const a of p) {
      expect(a.x).toBeGreaterThanOrEqual(s - 1e-9);
      expect(a.y).toBeGreaterThanOrEqual(s - 1e-9);
      expect(a.x + a.w + s).toBeLessThanOrEqual(bed[0] + 1e-9);
      expect(a.y + a.h + s).toBeLessThanOrEqual(bed[1] + 1e-9);
      const it = items[a.key]!;
      expect(a.rotated ? [a.h, a.w] : [a.w, a.h]).toEqual([it.w, it.h]);
    }
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) {
        const a = p[i]!, b = p[j]!;
        if (a.plate !== b.plate) continue;
        // grow one by the spacing: still no overlap
        expect(overlaps([a.x - s + 1e-6, a.y - s + 1e-6, a.w + 2 * s - 2e-6, a.h + 2 * s - 2e-6], [b.x, b.y, b.w, b.h])).toBe(false);
      }
  });

  test("splits onto several plates when one is full; refuses parts bigger than the bed", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ key: i, w: 90, h: 90 }));
    const p = packRects(items, [200, 200], 5);
    expect(new Set(p.map((x) => x.plate)).size).toBe(2); // 4 per plate, then 1
    expect(p.filter((x) => x.plate === 0).length).toBe(4);
    expect(() => packRects([{ key: 0, w: 300, h: 10 }], [200, 200], 5)).toThrow(/doesn't fit/);
  });

  test("turns a long part 90° when that's the only way it fits", () => {
    const p = packRects([{ key: 0, w: 20, h: 180 }], [200, 100], 5);
    expect(p[0]!.rotated).toBe(true);
  });
});

describe("plateParts", () => {
  test("copies are placed on z = 0 within the bed, with transforms that move the meshes there", async () => {
    const m = await meshOf(box(30, 20, 10, [100, 100, 50]));
    const r = plateParts([{ name: "p", mesh: m, copies: 3 }], { bed: [120, 120], spacing: 5 });
    expect(r.items.length).toBe(3);
    for (const it of r.items) {
      let minZ = Infinity, minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < m.positions.length; i += 3) {
        const q = apply4(it.transform, [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!]);
        minZ = Math.min(minZ, q[2]);
        minX = Math.min(minX, q[0]);
        maxX = Math.max(maxX, q[0]);
      }
      expect(minZ).toBeCloseTo(0, 6);
      expect(minX).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(maxX).toBeLessThanOrEqual(115 + 1e-6);
    }
  }, 30_000);
});

describe("tscad plate", () => {
  test("bed/copies parsing, several plates as -N files, 3MF notes per object", async () => {
    const { parseBed, parseCopies } = await import("../src/cli/plate");
    expect(parseBed("200x180")).toEqual([200, 180]);
    expect(parseBed("220")).toEqual([220, 220]);
    expect(() => parseBed("big")).toThrow(/WIDTHxDEPTH/);
    expect(parseCopies(["a=2,b=3", "c=1"])).toEqual({ a: 2, b: 3, c: 1 });
    const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { unzipSync, strFromU8 } = await import("fflate");
    const d = mkdtempSync(join(tmpdir(), "tscad-plate-"));
    writeFileSync(join(d, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "tscad" } }));
    writeFileSync(join(d, "m.tsx"), `import "tscad"\nexport default () => <>\n<part name="block"><box size={[60, 60, 10]} /></part>\n<part name="pin"><cylinder d={8} h={30} /></part>\n</>\n`);
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "../src/cli/index.ts"), "plate", "m.tsx", "-o", "out.3mf", "--bed", "100x100", "--copies", "block=2", "--json"], { cwd: d, env: { ...process.env, NO_COLOR: "1" } });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout.toString());
    expect(j.plates).toBe(2); // two 60×60 blocks don't share a 100×100 bed
    expect(existsSync(join(d, "out-1.3mf")) && existsSync(join(d, "out-2.3mf"))).toBe(true);
    const pin = j.items.find((i: any) => i.name === "pin");
    expect(pin.overhangArea).toBeLessThan(1);
    const model = strFromU8(unzipSync(readFileSync(join(d, "out-1.3mf")))["3D/3dmodel.model"]!);
    expect(model).toContain('xmlns:tscad="https://github.com/bherbruck/tscad"');
    expect(model).toMatch(/<metadata name="tscad:orientation">bottom: /);
    expect(model).toContain('name="block #1"');
  }, 60_000);
});
