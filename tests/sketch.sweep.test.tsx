/**
 * Sketch-driven sweeps (<sweepPath>) and lofts through constraint-sketch sections.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { compile, sketchRefs, type Children } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);
const PI = Math.PI;

async function evaluate(el: Children) {
  const r = compile(el);
  const e = await k.evaluate(r.document, { noMesh: true });
  const p = e.parts[0]!;
  if (!p.ok) throw new Error(JSON.stringify(p.error));
  return { volume: p.volume!, bbox: p.bbox!, r };
}
const near = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) / b).toBeLessThan(rel);

/** A J-hook path: up L1, a tangent half turn of radius R, down L2. */
function HookPath({ L1, R, L2 }: { L1: number; R: number; L2: number }) {
  const s = sketchRefs<{ o: "point"; up: "line"; bend: "arc" }>();
  return (
    <sketch>
      <point ref={s.o} fixed />
      <line ref={s.up} from={s.o} to="a" vertical length={L1} />
      <arc ref={s.bend} from="a" to="b" tangent={s.up} radius={R} angle={180} cw />
      <line from="b" to="c" tangent={s.bend} length={L2} />
    </sketch>
  );
}

describe("sweep along a drawn path", () => {
  test("closed circle path = torus (Pappus)", async () => {
    const { volume } = await evaluate(
      <sweep>
        <sweepPath><sketch><circle center={[0, 0]} r={20} fixed /></sketch></sweepPath>
        <circle r={3} />
      </sweep>,
    );
    near(volume, 2 * PI * 20 * PI * 9);
  }, 30_000);

  test("SVG path data: line, tangent quarter arc, line (XZ plane)", async () => {
    const { volume, bbox, r } = await evaluate(
      <sweep>
        <sweepPath plane="XZ"><path d="M0 0 V30 A10 10 0 0 0 10 40 H40" /></sweepPath>
        <circle r={3} />
      </sweep>,
    );
    expect(r.warnings).toEqual([]);
    near(volume, PI * 9 * (30 + 5 * PI + 30));
    // the path runs in XZ: from z = 0 up to z = 40, out to x = 40
    expect(bbox[1][0]).toBeCloseTo(40, 6);
    expect(bbox[1][2]).toBeCloseTo(43, 6);
    expect(bbox[0][1]).toBeCloseTo(-3, 6);
  }, 30_000);

  test("constraint-sketch path (J hook with a tangent arc), metadata on its plane", async () => {
    const { volume, r } = await evaluate(
      <sweep>
        <sweepPath plane="XZ"><HookPath L1={40} R={12} L2={15} /></sweepPath>
        <circle r={2.5} />
      </sweep>,
    );
    expect(r.warnings).toEqual([]);
    near(volume, PI * 6.25 * (40 + 12 * PI + 15));
    const path = r.sketches.find((s) => s.entities.some((e) => e.kind === "arc"))!;
    expect(path.dof).toBe(0);
    // sketch (x, y) → model (x, 0, y) on XZ
    const P = path.plane;
    expect([P[0], P[4], P[8], P[1], P[5], P[9]]).toEqual([1, 0, 0, 0, 0, 1]);
  }, 30_000);

  test("pieces join end to end (flipped when drawn backwards)", async () => {
    const { volume } = await evaluate(
      <sweep>
        <sweepPath plane="XZ">
          <path d="M0 0 V30" />
          <path d="M40 40 H10 A10 10 0 0 1 0 30" />
        </sweepPath>
        <circle r={3} />
      </sweep>,
    );
    near(volume, PI * 9 * (30 + 5 * PI + 30));
  }, 30_000);

  test("sharp corners warn; gaps and misuse are errors", () => {
    const r = compile(<sweep><sweepPath><path d="M0 0 V20 H20" /></sweepPath><circle r={1} /></sweep>);
    expect(r.warnings.some((w) => w.includes("1 sharp corner at (0, 20)"))).toBe(true);
    expect(() => compile(<sweep><sweepPath><path d="M0 0 V20" /><path d="M5 25 H20" /></sweepPath><circle r={1} /></sweep>)).toThrow(/gap at \(0, 20\)/);
    expect(() => compile(<extrude height={1}><sweepPath><path d="M0 0 V1" /></sweepPath><circle r={1} /></extrude>)).toThrow("only goes inside <sweep>");
    expect(() => compile(<sweep path={[[0, 0, 0], [0, 0, 1]]}><sweepPath><path d="M0 0 V1" /></sweepPath><circle r={1} /></sweep>)).toThrow("not both");
  });
});

describe("loft through constraint sketches", () => {
  /** A w × w square centred on the origin, fully constrained. */
  function Square({ w, z }: { w: number; z: number }) {
    return (
      <sketch z={z}>
        <point id="c" fixed />
        <line from="p1" to="p2" horizontal length={w} />
        <line from="p2" to="p3" vertical length={w} />
        <line from="p3" to="p4" horizontal />
        <line from="p4" to="p1" vertical />
        <symmetric a="p1" b="p3" about="c" />
      </sketch>
    );
  }
  test("ruled loft of three sketch sections = two frustums", async () => {
    const { volume, r } = await evaluate(
      <loft ruled>
        <Square w={20} z={0} />
        <Square w={10} z={10} />
        <Square w={16} z={25} />
      </loft>,
    );
    expect(r.sketches.map((s) => s.plane[11])).toEqual([0, 10, 25]);
    const frustum = (a: number, b: number, h: number) => (h / 3) * (a + b + Math.sqrt(a * b));
    near(volume, frustum(400, 100, 10) + frustum(100, 256, 15));
  }, 30_000);
});

describe("examples", () => {
  test("coat hook: plate + rod swept along a sketched tangent path (closed form)", async () => {
    const { renderModule } = await import("tscad");
    const r = renderModule(await import("../examples/sketch-coat-hook.tsx"));
    expect(r.warnings).toEqual([]);
    const e = await k.evaluate(r.document, { noMesh: true });
    const part = e.parts[0]!;
    expect(part.ok).toBe(true);
    const plate = (24 * 70 - (4 - PI) * 144) * 6;
    const hole = (PI * 2.25 / 3) * (2.25 ** 2 + 4.5 ** 2 + 2.25 * 4.5) + PI * 2.25 ** 2 * (6 - 2.25);
    const rod = PI * 16 * (35 + (14 * 75 * PI) / 180 + 18);
    near(part.volume!, plate - 2 * hole + rod);
  }, 30_000);

  test("vase: smooth loft of three sketched sections, shelled; fully constrained", async () => {
    const { renderModule } = await import("tscad");
    const r = renderModule(await import("../examples/sketch-vase.tsx"));
    expect(r.warnings).toEqual([]);
    expect(r.sketches.map((s) => [s.dof, s.plane[11]])).toEqual([[0, 0], [0, 54], [0, 120]]);
    const t0 = performance.now();
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.parts[0]!.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(10_000);
    const [min, max] = e.parts[0]!.bbox!;
    expect(max[2] - min[2]).toBeCloseTo(120, 6);
  }, 30_000);
});
