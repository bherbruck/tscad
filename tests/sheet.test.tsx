/**
 * Sheet metal: folded geometry (kernel volumes, bounding boxes) and flat patterns (bend
 * allowance BA = θ·(R + K·T)).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { compile, type Children } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";
import { loopArea } from "../src/core/sketch/boolean";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);
const PI = Math.PI;
const near = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(rel);

async function sheet(el: Children) {
  const r = compile(el);
  const e = await k.evaluate(r.document, { noMesh: true });
  const p = e.parts[0]!;
  if (!p.ok) throw new Error(JSON.stringify(p.error));
  const flat = r.drawings.find((d) => d.name.endsWith("-flat"))!;
  const area = flat.loops.reduce((s, l) => s + loopArea(l), 0);
  return { r, volume: p.volume!, bbox: p.bbox!, area, flat };
}
const T = 2, R = 2, K = 0.44;
const BA = (deg: number, r = R) => ((deg * PI) / 180) * (r + K * T);
/** Volume of a bend: θ·w·T·(R + T/2) (Pappus). */
const bendVol = (deg: number, w: number, r = R) => ((deg * PI) / 180) * w * T * (r + T / 2);

describe("sheet metal", () => {
  test("L bracket: flat length a + BA + b, folded volume, bounding box", async () => {
    const { volume, bbox, area, r } = await sheet(
      <sheetMetal name="L" thickness={T} bendRadius={R} kFactor={K}>
        <flange>
          <rect w={60} h={40} />
          <edgeFlange edge="+y" length={30} />
        </flange>
      </sheetMetal>,
    );
    near(area, 60 * (40 + BA(90) + 30));
    near(volume, 60 * 40 * T + 60 * 30 * T + bendVol(90, 60));
    expect(bbox[1]).toEqual([30, 20 + R + T, T + R + 30].map((v) => expect.closeTo(v, 6)) as any);
    expect(r.drawings.map((d) => [d.name, d.layer])).toEqual([["L-flat", "cut"], ["L-bends", "bend"], ["L-notes", "engrave"]]);
    const bendLine = r.drawings[1]!.loops[0]![0]!;
    expect(bendLine.kind === "line" && [bendLine.a[1], bendLine.b[1]]).toEqual([20 + BA(90) / 2, 20 + BA(90) / 2].map((v) => expect.closeTo(v, 9)) as any);
  }, 30_000);

  test("U channel (down bends) and the flat pattern", async () => {
    const { volume, area, bbox } = await sheet(
      <sheetMetal thickness={T} bendRadius={R} kFactor={K}>
        <flange>
          <rect w={100} h={30} />
          <edgeFlange edge="+y" length={20} direction="down" />
          <edgeFlange edge="-y" length={20} direction="down" />
        </flange>
      </sheetMetal>,
    );
    near(area, 100 * (30 + 2 * (BA(90) + 20)));
    near(volume, 100 * 30 * T + 2 * (100 * 20 * T + bendVol(90, 100)));
    expect(bbox[0][2]).toBeCloseTo(-R - 20, 6);
  }, 30_000);

  test("box tray: 4 flanges with open corners; folded volume by Pappus", async () => {
    const W = 100, D = 60, L = 20;
    const { volume, area } = await sheet(
      <sheetMetal thickness={T} bendRadius={R} kFactor={K}>
        <flange>
          <rect w={W} h={D} />
          <edgeFlange edge="+x" length={L} />
          <edgeFlange edge="-x" length={L} />
          <edgeFlange edge="+y" length={L} />
          <edgeFlange edge="-y" length={L} />
        </flange>
      </sheetMetal>,
    );
    near(area, W * D + 2 * (W + D) * (BA(90) + L));
    near(volume, W * D * T + 2 * (W + D) * (L * T) + 2 * (bendVol(90, W) + bendVol(90, D)));
  }, 30_000);

  test("K = 0.5: folded volume = flat area × thickness", async () => {
    const { volume, area } = await sheet(
      <sheetMetal thickness={T} bendRadius={R} kFactor={0.5}>
        <flange>
          <rect w={50} h={40} />
          <edgeFlange edge="+y" length={15} angle={60} />
          <edgeFlange edge="-x" length={10} angle={120} direction="down" />
        </flange>
      </sheetMetal>,
    );
    near(volume, area * T);
  }, 30_000);

  test("insets cut bend reliefs into the base; holes in flanges; a hem and a return", async () => {
    const { area, volume } = await sheet(
      <sheetMetal thickness={T} bendRadius={R} kFactor={K}>
        <flange>
          <rect w={80} h={50} />
          <circle r={5} />
          <edgeFlange edge="+y" length={25} inset={10}>
            <circle r={3} x={30} y={12} />
            <hem edge="end" length={8} />
          </edgeFlange>
        </flange>
      </sheetMetal>,
    );
    const relief = 2 * T * (R + T);
    const hemBA = PI * (T / 2 + K * T);
    near(area, 80 * 50 - PI * 25 - relief + 60 * (BA(90) + 25 + hemBA + 8) - PI * 9);
    near(volume, (80 * 50 - PI * 25 - relief) * T + 60 * 25 * T - PI * 9 * T + bendVol(90, 60) + 60 * 8 * T + PI * 60 * T * (T / 2 + T / 2));
  }, 30_000);

  test("jog: the jogged flange sits `offset` higher", async () => {
    const { bbox } = await sheet(
      <sheetMetal thickness={T} bendRadius={R}>
        <flange>
          <rect w={40} h={30} />
          <jog edge="+y" offset={12} length={20} />
        </flange>
      </sheetMetal>,
    );
    // the jogged flange's top face: offset + T
    expect(bbox[1][2]).toBeCloseTo(12 + T, 6);
  }, 30_000);

  test("edges by constraint-sketch line id; errors", async () => {
    const { area } = await sheet(
      <sheetMetal thickness={T} bendRadius={R} kFactor={K}>
        <flange>
          <sketch>
            <point id="o" fixed />
            <line id="front" from="o" to="a" horizontal length={50} />
            <line from="a" to="b" vertical length={30} />
            <line id="back" from="b" to="c" horizontal />
            <line from="c" to="o" vertical />
          </sketch>
          <edgeFlange edge="back" length={10} />
        </flange>
      </sheetMetal>,
    );
    near(area, 50 * (30 + BA(90) + 10));
    expect(() => compile(<sheetMetal thickness={1}><flange><rect w={10} h={10} /><edgeFlange edge="nope" length={5} /></flange></sheetMetal>)).toThrow(/no edge "nope"/);
    expect(() => compile(<edgeFlange edge="+x" length={5} />)).toThrow("belongs inside a <sheetMetal>");
  }, 30_000);
});

describe("sheet metal examples", () => {
  test("L-bracket: folded volume and flat area by formula; drawings for DXF", async () => {
    const { renderModule } = await import("tscad");
    const r = renderModule(await import("../examples/sheet-l-bracket.tsx"));
    expect(r.warnings).toEqual([]);
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.parts[0]!.ok).toBe(true);
    const t = 2, rad = 2, kk = 0.44, w = 60;
    const slot = (13.75 - 5.5) * 5.5 + PI * 2.75 ** 2;
    const flatArea = w * 40 - 2 * slot + w * 50 - 3 * PI * 2.75 ** 2 + w * 8;
    const bend = (PI / 2) * w * t * (rad + t / 2);
    near(e.parts[0]!.volume!, flatArea * t + 2 * bend);
    const flat = r.drawings.find((d) => d.name === "l-bracket-flat")!;
    near(flat.loops.reduce((s, l) => s + loopArea(l), 0), flatArea + 2 * w * (PI / 2) * (rad + kk * t));
    expect(r.drawings.find((d) => d.name === "l-bracket-bends")!.loops.length).toBe(2);
  }, 30_000);

  test("chassis tray evaluates (< 10 s) with its flat pattern", async () => {
    const { renderModule } = await import("tscad");
    const r = renderModule(await import("../examples/sheet-chassis.tsx"));
    expect(r.warnings).toEqual([]);
    const t0 = performance.now();
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.parts[0]!.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(r.drawings.find((d) => d.name === "chassis-bends")!.loops.length).toBe(6);
  }, 30_000);
});
