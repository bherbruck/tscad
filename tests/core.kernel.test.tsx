/**
 * Integration: compiled models evaluated by the real kernel (wasm).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { compile, defineParams, edges, faces, renderModule, type Children, type ParamValues } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);

const PI = Math.PI;
/** Cross-section removed by a fillet of radius r on a 90° edge. */
const filletArea = (r: number) => r * r * (1 - PI / 4);

async function volume(el: Children): Promise<number> {
  const { document } = compile(el);
  const r = await k.evaluate(document, { noMesh: true });
  const p = r.parts[0]!;
  if (!p.ok) throw new Error(`kernel: ${JSON.stringify(p.error)}`);
  return p.volume!;
}

describe("kernel integration", () => {
  const cases: [string, Children, number, number?][] = [
    ["plate with a hole", <extrude height={5}><rect w={40} h={30} /><circle r={5} /></extrude>, 40 * 30 * 5 - PI * 25 * 5],
    ["plate on XZ, centred", <extrude height={5} plane="XZ" center><rect w={40} h={30} /><circle r={5} /></extrude>, 40 * 30 * 5 - PI * 25 * 5],
    ["even-odd rings", <extrude height={2}><circle r={20} /><circle r={15} /><circle r={10} /><circle r={5} /></extrude>, (400 - 225 + 100 - 25) * PI * 2],
    ["ellipse (rational NURBS)", <extrude height={2}><ellipse rx={10} ry={5} /></extrude>, PI * 50 * 2],
    ["rounded rect", <extrude height={1}><roundedRect w={20} h={10} r={3} /></extrude>, 200 - (4 - PI) * 9],
    ["slot", <extrude height={1}><slot length={20} width={6} /></extrude>, 14 * 6 + PI * 9],
    ["hex with bore", <extrude height={2}><regularPolygon sides={6} flats={10} /><circle d={5} /></extrude>, (2 * Math.sqrt(3) * 25 - PI * 6.25) * 2],
    ["svg path with arc", <extrude height={1}><path d="M0 0 H20 V10 A10 10 0 0 1 0 10 Z" /></extrude>, 200 + PI * 50],
    ["revolved ring", <revolve><rect w={5} h={10} x={12.5} y={5} /></revolve>, PI * (225 - 100) * 10],
    ["half torus", <revolve angle={180}><circle r={2} x={10} /></revolve>, (PI * 4 * 2 * PI * 10) / 2],
    ["ruled loft frustum", <loft ruled><circle r={10} z={0} /><circle r={5} z={20} /></loft>, (PI * 20 * (100 + 50 + 25)) / 3],
    ["tube sweep", <sweep path={[[0, 0, 0], [0, 0, 20]]}><circle r={3} /><circle r={2} /></sweep>, PI * 5 * 20],
    ["shelled box", <shell thickness={1} open={faces.top()}><box size={[20, 20, 10]} /></shell>, 4000 - 18 * 18 * 9],
    ["bolt circle", <difference><cylinder r={20} h={5} /><polarPattern count={6} radius={15}><cylinder r={2} h={5} /></polarPattern></difference>, PI * 400 * 5 - 6 * PI * 4 * 5],
    ["mirror keep", <mirror axis="x" keep><box size={5} x={10} /></mirror>, 250],
    ["grid of pegs", <gridPattern nx={3} ny={2} dx={10} dy={10}><cylinder r={1} h={4} /></gridPattern>, 6 * PI * 4],
    ["placement", <intersection><box size={10} center /><sphere r={5} rotate={[30, 40, 50]} at={[5, 5, 5]} /></intersection>, (4 / 3) * PI * 125 / 8],
    ["cone, torus", <union><cone r1={5} r2={0} h={10} /><torus R={20} r={2} /></union>, (PI * 25 * 10) / 3 + 2 * PI * PI * 20 * 4],
  ];
  for (const [name, el, expected, tol] of cases) {
    test(name, async () => {
      const v = await volume(el);
      expect(Math.abs(v - expected) / expected).toBeLessThan(tol ?? 1e-4);
    }, 30_000);
  }

  test("fillet volumes match closed forms (the right edges are blended)", async () => {
    const box = <box size={[20, 20, 10]} />;
    // 4 vertical edges, r = 2: 4 · (4 − π) · 10
    const v = await volume(<fillet radius={2} edges={edges.vertical()}>{box}</fillet>);
    expect(v).toBeCloseTo(4000 - 4 * (4 - PI) * 10, 3);
    expect(await volume(<fillet radius={2} edges="|Z">{box}</fillet>)).toBeCloseTo(v, 6);
    // top loop, r = 1, sharp vertical edges → mitred corners: each edge removes A·20, and at
    // each corner the two removed prisms overlap in r³(5/3 − π/2) (cube minus two quarter
    // cylinders' union; their intersection is 1/8 of a Steinmetz solid, 2r³/3)
    const loop = 4000 - 4 * 20 * filletArea(1) + 4 * (5 / 3 - PI / 2);
    expect(await volume(<fillet radius={1} edges=">Z">{box}</fillet>)).toBeCloseTo(loop, 3);
    expect(await volume(<fillet radius={1} edges={edges.bottom()}>{box}</fillet>)).toBeCloseTo(loop, 3);
  }, 60_000);

  test("chamfer top loop closed form", async () => {
    // 4 edges, d = 1: prisms of area d²/2 × 20, overlapping in d³/3 at each corner
    const v = await volume(<chamfer distance={1} edges=">Z"><box size={[20, 20, 10]} /></chamfer>);
    expect(v).toBeCloseTo(4000 - 4 * 20 * 0.5 + 4 / 3, 3);
  }, 30_000);

  test("fillet/chamfer on a rounded-rect extrusion and fillet all with a hole", async () => {
    const rr = <extrude height={5}><roundedRect w={30} h={20} r={4} /></extrude>;
    expect(await volume(<fillet radius={1} edges=">Z">{rr}</fillet>)).toBeLessThan(await volume(rr));
    expect(await volume(<chamfer distance={1} edges={edges.top()}>{rr}</chamfer>)).toBeLessThan(await volume(rr));
    const holed = <difference><box size={[20, 20, 10]} /><cylinder r={3} h={10} /></difference>;
    expect(await volume(<fillet radius={1} edges={edges.all()}>{holed}</fillet>)).toBeLessThan(await volume(holed));
  }, 60_000);

  test("multi-part assembly evaluates every part", async () => {
    const { document } = compile(
      <assembly>
        <part name="base" material="pla"><box size={[30, 30, 3]} /></part>
        <part name="post" color="#c33" z={3}><cylinder r={3} h={20} /></part>
      </assembly>,
    );
    const r = await k.evaluate(document);
    expect(r.ok).toBe(true);
    expect(r.parts.map((p) => p.name)).toEqual(["base", "post"]);
    expect(r.parts[1]!.bbox![0][2]).toBeCloseTo(3);
    expect(await k.mesh("post")).toBeDefined();
  }, 30_000);

  test("kernel error paths resolve through the source map", async () => {
    const { document, sourceMap } = compile(
      <part name="bad">
        <union>
          <box size={10} />
          <fillet radius={1} edges={edges.radius(123)}>
            <box size={10} />
          </fillet>
        </union>
      </part>,
    );
    const r = await k.evaluate(document);
    const err = r.parts[0]!.error!;
    expect(err.op).toBe("fillet");
    const loc = sourceMap[err.path]!;
    expect(loc.tag).toBe("fillet");
    expect(loc.file).toEndWith("core.kernel.test.tsx");
  }, 30_000);

  test("renderModule → kernel, param change re-evaluates", async () => {
    const params = defineParams({
      w: { type: "number", default: 20, min: 5, max: 50 },
      holes: { type: "int", default: 2, min: 0, max: 4 },
    });
    function Plate({ w, holes }: ParamValues<typeof params>) {
      return (
        <part name="plate">
          <extrude height={2}>
            <rect w={w} h={10} />
            {Array.from({ length: holes }, (_, i) => (
              <circle key={i} r={1} x={(i - (holes - 1) / 2) * 4} />
            ))}
          </extrude>
        </part>
      );
    }
    const mod = { default: Plate, params };
    const v1 = (await k.evaluate(renderModule(mod).document)).parts[0]!.volume!;
    const v2 = (await k.evaluate(renderModule(mod, { w: 30, holes: 0 }).document)).parts[0]!.volume!;
    expect(v1).toBeCloseTo(400 - 2 * PI * 2, 3);
    expect(v2).toBeCloseTo(600, 3);
  }, 30_000);
});
