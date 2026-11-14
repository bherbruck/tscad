import { beforeAll, describe, expect, test } from "bun:test";
import { compile, type Children } from "tscad";
import { buildBvh, checkInterference, checkPrintability, checkWatertight, raycast } from "../src/check";
import { loadKernel, type KernelHost, type MeshArrays } from "../src/kernel/index.ts";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);

async function mesh(el: Children): Promise<MeshArrays> {
  const r = await k.evaluate(compile(<part name="m">{el}</part>).document);
  if (!r.ok) throw new Error(JSON.stringify(r.parts[0]?.error));
  return (await k.mesh("m"))!;
}

describe("bvh", () => {
  test("ray casts hit the nearest triangle", () => {
    // two parallel unit squares at z = 1 and z = 3
    const positions = [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 3, 1, 0, 3, 1, 1, 3, 0, 1, 3];
    const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const b = buildBvh(positions, indices);
    expect(raycast(b, [0.3, 0.3, 0], [0, 0, 1])!.t).toBeCloseTo(1);
    expect(raycast(b, [0.3, 0.3, 2], [0, 0, 1])!.t).toBeCloseTo(1);
    expect(raycast(b, [0.3, 0.3, 0], [0, 0, 1], 0, Infinity, (t) => t >= 2)!.t).toBeCloseTo(3);
    expect(raycast(b, [2, 2, 0], [0, 0, 1])).toBeUndefined();
  });
});

describe("printability", () => {
  test("a T: the arms' undersides overhang", async () => {
    const m = await mesh(
      <union>
        <box size={[6, 6, 20]} />
        <box size={[30, 6, 4]} z={20} />
      </union>,
    );
    const r = checkPrintability(m);
    expect(r.overhang.area).toBeCloseTo(2 * 12 * 6, 6);
    expect(r.overhang.faces.length).toBe(2);
    expect(r.overhang.faces[0]!.maxAngle).toBeCloseTo(90);
    // every overhanging triangle faces straight down, at z = 20
    for (const t of r.overhang.triangles) {
      expect(r.overhang.severity[t]).toBeCloseTo(1);
      const z = m.positions[m.indices[3 * t]! * 3 + 2]!;
      expect(z).toBeCloseTo(20);
    }
    expect(r.warnings.some((w) => w.includes("overhangs"))).toBe(true);
    // printed on its side (build direction +Y) the T has no ceilings
    expect(checkPrintability(m, { buildDir: [0, 1, 0] }).overhang.area).toBeCloseTo(0);
  }, 30_000);

  test("45° chamfer is fine at 45°, a 30° slope is not", async () => {
    // a wedge (prism) whose underside is at 45° and one at 60° from vertical
    const wedge = (deg: number) => (
      <extrude height={10} plane="XZ" center>
        <polygon points={[[0, 0], [10, 0], [10, 10], [-10 / Math.tan((deg * Math.PI) / 180), 10]].map(([x, y]) => [x!, y!] as [number, number])} />
      </extrude>
    );
    expect(checkPrintability(await mesh(wedge(45))).overhang.area).toBeCloseTo(0);
    expect(checkPrintability(await mesh(wedge(30))).overhang.area).toBeGreaterThan(0);
  }, 30_000);

  test("wall thickness of a 2 mm shell ≈ 2; solid block ≈ its size", async () => {
    const r = checkPrintability(await mesh(<shell thickness={2} open=">Z"><box size={[30, 30, 20]} /></shell>));
    expect(r.thickness!.min).toBeCloseTo(2, 6);
    expect(r.thickness!.thinArea).toBe(0);
    const thin = checkPrintability(await mesh(<shell thickness={0.5} open=">Z"><box size={[30, 30, 20]} /></shell>), { minWall: 0.8 });
    expect(thin.thickness!.min).toBeCloseTo(0.5, 6);
    expect(thin.thickness!.thinFraction).toBeGreaterThan(0.9);
    expect(thin.warnings.some((w) => w.includes("thinner than 0.8"))).toBe(true);
    const block = checkPrintability(await mesh(<box size={[30, 20, 10]} />));
    expect(block.thickness!.min).toBeCloseTo(10, 6);
    // per vertex view for heatmaps
    expect(block.thickness!.byVertex.length).toBe(0 + (await mesh(<box size={[30, 20, 10]} />)).positions.length / 3);
  }, 30_000);

  test("bed fit, rotated fit", async () => {
    const m = await mesh(<box size={[250, 100, 10]} />);
    expect(checkPrintability(m, { bed: [256, 256, 256], skipThickness: true }).bed).toEqual({ fits: true, rotated: false });
    expect(checkPrintability(m, { bed: [120, 260, 100], skipThickness: true }).bed).toEqual({ fits: true, rotated: true });
    const no = checkPrintability(m, { bed: [200, 200, 200], skipThickness: true });
    expect(no.bed!.fits).toBe(false);
    expect(no.warnings.join()).toContain("does not fit");
  }, 30_000);
});

describe("watertight", () => {
  test("kernel meshes are closed; a cut-open mesh is not", async () => {
    const plate = await mesh(<extrude height={5}><rect w={40} h={30} /><circle r={5} /></extrude>);
    const w = checkWatertight(plate);
    expect(w.watertight).toBe(true);
    expect(w.euler).toBe(0); // genus 1
    const open = { positions: plate.positions, indices: plate.indices.slice(3) };
    const o = checkWatertight(open);
    expect(o.watertight).toBe(false);
    expect(o.boundaryEdges).toBe(3);
    const flipped = Uint32Array.from(plate.indices);
    [flipped[1], flipped[2]] = [flipped[2]!, flipped[1]!];
    expect(checkWatertight({ positions: plate.positions, indices: flipped }).flippedEdges).toBeGreaterThan(0);
  }, 30_000);
});

describe("interference", () => {
  test("overlap volume of two boxes; far parts skipped; session restored", async () => {
    const doc = compile(
      <assembly>
        <part name="a"><box size={[10, 10, 10]} /></part>
        <part name="b" x={5} y={2}><box size={[10, 10, 10]} /></part>
        <part name="c" x={50}><box size={4} /></part>
        <part name="d" z={10}><box size={[10, 10, 2]} /></part>
      </assembly>,
    ).document;
    const r = await checkInterference(k, doc);
    expect(r.ok).toBe(false);
    expect(r.pairs.map((p) => [p.a, p.b])).toEqual([["a", "b"]]);
    expect(r.pairs[0]!.volume).toBeCloseTo(5 * 8 * 10, 6);
    expect(r.skipped).toBeGreaterThanOrEqual(3); // c is far; d only touches a/b
    expect(await k.mesh("a")).toBeDefined(); // the model's parts are back in the session
    const clear = await checkInterference(k, compile(<assembly><part name="a"><box size={10} /></part><part name="b" x={10}><box size={10} /></part></assembly>).document);
    expect(clear.ok).toBe(true);
  }, 30_000);
});
