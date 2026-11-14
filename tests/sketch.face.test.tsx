/**
 * Sketch on a face: <onFace>, <pocket>, <boss>, <cutThrough> through the kernel's onFace node.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { compile, faces, type Children } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);
const PI = Math.PI;

async function volume(el: Children) {
  const r = compile(el);
  const e = await k.evaluate(r.document, { noMesh: true });
  const p = e.parts[0]!;
  if (!p.ok) throw new Error(JSON.stringify(p.error));
  return { v: p.volume!, r, bbox: p.bbox! };
}
const near = (a: number, b: number) => expect(Math.abs(a - b) / b).toBeLessThan(1e-6);
const block = <box size={[40, 30, 10]} center />;

describe("sketch on face", () => {
  test("onFace: tools in the face frame, unioned", async () => {
    const { v } = await volume(<onFace face=">Z">{block}<cylinder r={5} h={10} /></onFace>);
    near(v, 12000 + PI * 25 * 10);
  }, 30_000);

  test("boss on top, pocket in a side face (x/y move the profile in the face)", async () => {
    const boss = await volume(<boss face=">Z" height={10}>{block}<circle r={5} x={8} /></boss>);
    near(boss.v, 12000 + PI * 250);
    expect(boss.bbox[1][0]).toBeCloseTo(20, 6);
    const pocket = await volume(<pocket face=">X" depth={4}>{block}<rect size={6} /></pocket>);
    near(pocket.v, 12000 - 144);
  }, 30_000);

  test("a counterbored hole on a slanted face (chained: cutThrough, then pocket)", async () => {
    const top = faces.within([-21, -16, -4], [21, 11, 12.5]);
    const { v } = await volume(
      <pocket face={top} depth={3}>
        <cutThrough face={top}>
          <rotate x={30}>{block}</rotate>
          <circle r={2.5} />
        </cutThrough>
        <circle r={5} />
      </pocket>,
    );
    near(v, 12000 - PI * 6.25 * 10 - PI * (25 - 6.25) * 3);
  }, 30_000);

  test("chained onFace: a pocket in the top of a boss", async () => {
    const { v } = await volume(
      <pocket face=">Z" depth={2}>
        <boss face=">Z" height={10}>{block}<circle r={5} /></boss>
        <circle r={2} />
      </pocket>,
    );
    near(v, 12000 + PI * 250 - PI * 4 * 2);
  }, 30_000);

  test("a constraint sketch on a face; its metadata says so", async () => {
    const { v, r } = await volume(
      <pocket face=">Z" depth={2}>
        {block}
        <sketch>
          <point id="o" x={-5} y={-5} fixed />
          <line from="o" to="a" horizontal length={10} />
          <line from="a" to="b" vertical length={10} />
          <line from="b" to="c" horizontal />
          <line from="c" to="o" vertical />
        </sketch>
      </pocket>,
    );
    near(v, 12000 - 200);
    expect(r.sketches[0]!.onFace).toBe("parts/0");
    expect(r.sourceMap["parts/0/base"]?.tag).toBe("box");
  }, 30_000);

  test("errors", () => {
    // @ts-expect-error face is required
    expect(() => compile(<pocket depth={2}>{block}<circle r={1} /></pocket>)).toThrow("missing face");
    expect(() => compile(<pocket face=">Z" depth={2}><circle r={1} /></pocket>)).toThrow("needs a base solid");
    expect(() => compile(<boss face=">Z" height={2}>{block}</boss>)).toThrow("needs a 2D profile");
  });
});

test("example: bearing block evaluates (< 10 s), every feature cut", async () => {
  const { renderModule } = await import("tscad");
  const r = renderModule(await import("../examples/sketch-on-face.tsx"));
  expect(r.warnings).toEqual([]);
  const t0 = performance.now();
  const e = await k.evaluate(r.document, { noMesh: true });
  expect(e.parts[0]!.ok).toBe(true);
  expect(performance.now() - t0).toBeLessThan(10_000);
  const [w, d, t, B, H, bw, br, s] = [60, 50, 10, 32, 8, 7, 10, 46];
  const solid = w * d * t + PI * (B / 2) ** 2 * H;
  const bearing = PI * 11 ** 2 * bw, bore = PI * (br / 2) ** 2 * (t + H - bw);
  const holes = 4 * (PI * 2.25 ** 2 * t + PI * (16 - 2.25 ** 2) * 3);
  const slot = (12 * 4 + PI * 4) * 6;
  near(e.parts[0]!.volume!, solid - bearing - bore - holes - slot);
}, 30_000);
