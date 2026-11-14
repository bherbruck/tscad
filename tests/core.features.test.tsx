import { beforeAll, describe, expect, test } from "bun:test";
import { compile, faces, type Children, type Node } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

const ir = (el: Children): Node => compile(el).document.parts![0]!.node;
const DEG = Math.PI / 180;

describe("draft / pushPull / split IR", () => {
  test("draft: degrees → radians, walls by default, neutral height", () => {
    const n = ir(<draft angle={5}><sphere r={1} /></draft>) as any;
    expect(n).toMatchObject({ type: "draft", faces: { type: "perpendicular", axis: "z" } });
    expect(n.angle).toBeCloseTo(5 * DEG);
    expect(n.origin).toBeUndefined();
    const m = ir(<draft angle={3} neutral={10} pull="-z" faces="|X"><sphere r={1} /></draft>) as any;
    expect(m.pull).toEqual([0, 0, -1]);
    expect(m.origin).toEqual([0, 0, -10]);
    expect(m.normal).toEqual([0, 0, -1]);
    expect(m.faces).toEqual({ type: "parallel", axis: "x" });
    expect(ir(<draft angle={0}><sphere r={1} /></draft>)).toEqual({ type: "sphere", radius: 1 });
    expect(() => compile(<draft angle={3} pull={[1, 1, 0]}><sphere r={1} /></draft>)).toThrow(/give faces/);
    expect(() => compile(<draft angle={95}><sphere r={1} /></draft>)).toThrow(/between -90 and 90/);
  });
  test("pushPull (alias offsetFaces)", () => {
    expect(ir(<pushPull distance={2} faces={faces.top()}><sphere r={1} /></pushPull>)).toEqual({
      type: "offsetFaces", distance: 2, faces: { type: "max", axis: "z" }, children: [{ type: "sphere", radius: 1 }],
    } as Node);
    expect(ir(<offsetFaces d={-1} faces="<Z"><sphere r={1} /></offsetFaces>)).toMatchObject({ type: "offsetFaces", distance: -1 });
    expect(ir(<pushPull distance={0} faces=">Z"><sphere r={1} /></pushPull>)).toEqual({ type: "sphere", radius: 1 });
    // @ts-expect-error faces is required
    expect(() => compile(<pushPull distance={1}><sphere r={1} /></pushPull>)).toThrow(/missing faces/);
  });
  test("split: named planes, offset, custom plane, keep; placement applies after", () => {
    expect(ir(<split><sphere r={1} /></split>)).toEqual({ type: "split", origin: [0, 0, 0], normal: [0, 0, 1], children: [{ type: "sphere", radius: 1 }] } as Node);
    expect(ir(<split plane="XZ" offset={2} keep="below"><sphere r={1} /></split>)).toMatchObject({ origin: [0, 2, 0], normal: [0, 1, 0], keep: "below" });
    const c = ir(<split plane={{ origin: [1, 2, 3], normal: [2, 0, 0] }} z={5}><sphere r={1} /></split>) as any;
    expect(c.type).toBe("transform");
    expect(c.children[0]).toMatchObject({ type: "split", origin: [1, 2, 3], normal: [1, 0, 0] });
    expect(() => compile(<split plane={"AB" as any}><sphere r={1} /></split>)).toThrow(/plane must be/);
  });
});

describe("draft / pushPull / split in the kernel", () => {
  let k: KernelHost;
  beforeAll(async () => {
    k = await loadKernel();
  }, 30_000);
  async function part(el: Children) {
    const r = await k.evaluate(compile(<part name="p">{el}</part>).document, { noMesh: true });
    const p = r.parts[0]!;
    if (!p.ok) throw new Error(JSON.stringify(p.error));
    return p;
  }
  test("split a sphere: half the volume", async () => {
    const p = await part(<split><sphere r={10} /></split>);
    expect(p.volume!).toBeCloseTo(((4 / 3) * Math.PI * 1000) / 2, 3);
    expect(p.bbox![0][2]).toBeCloseTo(0, 6);
    const below = await part(<split keep="below" offset={5}><sphere r={10} /></split>);
    // cap volume above z=5 is π h²(3r − h)/3 with h = 5
    expect(below.volume!).toBeCloseTo((4 / 3) * Math.PI * 1000 - (Math.PI * 25 * 25) / 3, 2);
  }, 30_000);
  test("pushPull the top of a 10³ box by +2 → 1200", async () => {
    const p = await part(<pushPull distance={2} faces=">Z"><box size={10} /></pushPull>);
    expect(p.volume!).toBeCloseTo(1200, 6);
    expect(p.bbox![1][2]).toBeCloseTo(12, 6);
  }, 30_000);
  test("draft 5° on a box's walls", async () => {
    const p = await part(<draft angle={5}><box size={[20, 20, 10]} /></draft>);
    // walls lean in about the base: top shrinks by 10·tan 5° per side → a frustum of squares
    const t = 10 * Math.tan(5 * DEG);
    const top = 20 - 2 * t;
    expect(p.volume!).toBeCloseTo((10 / 3) * (400 + top * top + 20 * top), 2);
    expect(p.bbox![1][0] - p.bbox![0][0]).toBeCloseTo(20, 6);
  }, 30_000);
});
