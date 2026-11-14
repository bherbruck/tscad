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
    const bendLine = r.drawings[1]!.paths![0]![0]!;
    expect(r.drawings[1]!.loops).toEqual([]);
    expect(r.drawings[1]!.notes!.map((n) => n.text)).toEqual(["UP 90° R2"]);
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

  describe("corners", () => {
    const W = 100, D = 60, L = 20;
    const tray = (o: Record<string, unknown>) =>
      sheet(
        <sheetMetal thickness={T} bendRadius={R} kFactor={K}>
          <flange>
            <rect w={W} h={D} />
            <edgeFlange edge="+x" length={L} {...o} />
            <edgeFlange edge="+y" length={L} {...o} />
            <edgeFlange edge="-x" length={L} {...o} />
            <edgeFlange edge="-y" length={L} {...o} />
          </flange>
        </sheetMetal>,
      );
    const bends = bendVol(90, W) * 2 + bendVol(90, D) * 2;
    test("closed: mitred on the diagonal (solid); square at the inside of the mitre (flat)", async () => {
      const g2 = 0.2 / Math.SQRT2; // default gap 0.2, half of it each side of the diagonal
      const { volume, area } = await tray({ corner: "closed" });
      // each of the 8 ends: a trapezoid prism reaching R..R+T past the edge, less the gap
      near(volume, W * D * T + 2 * (W + D) * L * T + 8 * L * T * (R + T / 2 - g2) + bends);
      near(area, W * D + 2 * (W + D) * (BA(90) + L) + 8 * L * (R - g2));
    }, 30_000);
    test("overlap: each flange covers the next one's end", async () => {
      const gap = 0.3;
      const { volume, area } = await tray({ corner: "overlap", cornerGap: gap });
      const run = 2 * (W + D) + 4 * (R + T + R - gap);
      near(volume, W * D * T + run * L * T + bends);
      near(area, W * D + 2 * (W + D) * BA(90) + run * L);
    }, 30_000);
    test("corner reliefs: rect / round cut the parent and cut the bends back", async () => {
      const s = R + T;
      const cut = (W + D) * 2 - 8 * s; // bend lengths left
      const rect = await tray({ cornerRelief: "rect" });
      near(rect.area, W * D - 4 * s * s + BA(90) * cut + 2 * (W + D) * L);
      near(rect.volume, (W * D - 4 * s * s) * T + 2 * (W + D) * L * T + bendVol(90, cut));
      const round = await tray({ cornerRelief: "round", cornerReliefSize: 3 });
      near(round.area, W * D - PI * 9 + BA(90) * ((W + D) * 2 - 24) + 2 * (W + D) * L);
      const tear = await tray({ cornerRelief: "tear" });
      near(tear.area, W * D + 2 * (W + D) * (BA(90) + L));
    }, 30_000);
    test("non-square or mixed flanges stay open, with a warning", () => {
      const r = compile(
        <sheetMetal thickness={T} bendRadius={R}>
          <flange>
            <rect w={W} h={D} />
            <edgeFlange edge="+x" length={L} corner="closed" />
            <edgeFlange edge="+y" length={L} angle={60} />
          </flange>
        </sheetMetal>,
      );
      expect(r.warnings.map((w) => String((w as any).message ?? w))).toEqual([expect.stringContaining("both flanges must be 90°")]);
    });
  });

  test("profiled flange: a tapered tab with a hole; edges by index", async () => {
    const { volume, area } = await sheet(
      <sheetMetal thickness={T} bendRadius={R} kFactor={K}>
        <flange>
          <rect w={60} h={40} />
          <edgeFlange edge="+y" profile>
            <polygon points={[[0, 0], [60, 0], [45, 20], [15, 20]]} />
            <circle r={4} x={30} y={10} />
          </edgeFlange>
        </flange>
      </sheetMetal>,
    );
    const tab = 0.5 * (60 + 30) * 20 - PI * 16;
    near(area, 60 * 40 + 60 * BA(90) + tab);
    near(volume, (60 * 40 + tab) * T + bendVol(90, 60));
    expect(() =>
      compile(
        <sheetMetal thickness={T}>
          <flange>
            <rect w={60} h={40} />
            <edgeFlange edge="+y" profile><rect w={50} h={10} /></edgeFlange>
          </flange>
        </sheetMetal>,
      ),
    ).toThrow(/stands on its bend line/);
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
    expect(r.drawings.find((d) => d.name === "l-bracket-bends")!.paths!.length).toBe(2);
  }, 30_000);

  test("chassis tray evaluates (< 10 s) with its flat pattern", async () => {
    const { renderModule } = await import("tscad");
    const r = renderModule(await import("../examples/sheet-chassis.tsx"));
    expect(r.warnings).toEqual([]);
    const t0 = performance.now();
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.parts[0]!.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(r.drawings.find((d) => d.name === "chassis-bends")!.paths!.length).toBe(6);
  }, 30_000);
});

/** DXF group-code pairs → entities (type, layer, codes). */
function dxfEntities(text: string) {
  const lines = text.split("\n");
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]!]);
  expect(pairs.every(([c]) => Number.isInteger(c))).toBe(true);
  const at = pairs.findIndex(([c, v], i) => c === 2 && v === "ENTITIES" && pairs[i - 1]![1] === "SECTION");
  const out: { type: string; layer: string; codes: [number, string][] }[] = [];
  for (const [c, v] of pairs.slice(at + 1)) {
    if (c === 0) {
      if (v === "ENDSEC") break;
      out.push({ type: v, layer: "", codes: [] });
    } else {
      const e = out[out.length - 1]!;
      if (c === 8) e.layer = v;
      e.codes.push([c, v]);
    }
  }
  return { out, layers: pairs.filter(([c], i) => c === 2 && pairs[i - 1]![1] === "LAYER").map(([, v]) => v) };
}

describe("sheet metal flat pattern → DXF / SVG", () => {
  test("bend lines are open paths; notes are TEXT; both entity styles parse", async () => {
    const { toDXF, toSVG } = await import("../src/drawing/index.ts");
    const { renderModule } = await import("tscad");
    const r = renderModule(await import("../examples/sheet-chassis.tsx"));
    const prim = dxfEntities(toDXF(r.drawings));
    expect(prim.layers).toEqual(["CUT", "BEND", "ENGRAVE"]);
    const bend = prim.out.filter((e) => e.layer === "BEND");
    expect(bend.filter((e) => e.type === "LINE").length).toBe(6);
    const texts = bend.filter((e) => e.type === "TEXT");
    expect(texts.map((e) => e.codes.find(([c]) => c === 1)![1]).sort()).toEqual([...Array(2).fill("DN 90%%d R1.2"), ...Array(4).fill("UP 90%%d R1.2")]);
    // the side walls' bend lines run along y: their notes are turned 90°
    expect(texts.filter((e) => e.codes.some(([c, v]) => c === 50 && v === "90")).length).toBe(4);
    // polyline style: every bend line one open 2-vertex POLYLINE, the outline closed
    const pl = dxfEntities(toDXF(r.drawings, { entities: "polyline" })).out;
    const open = pl.filter((e) => e.type === "POLYLINE" && e.layer === "BEND");
    expect(open.length).toBe(6);
    expect(open.every((e) => e.codes.some(([c, v]) => c === 70 && v === "0"))).toBe(true);
    const verts = pl.filter((e) => e.type === "VERTEX" && e.layer === "BEND").length;
    expect(verts).toBe(12);
    expect(pl.filter((e) => e.type === "POLYLINE" && e.layer === "CUT").every((e) => e.codes.some(([c, v]) => c === 70 && v === "1"))).toBe(true);
    // SVG: the bend group's path has no Z, and the notes are <text>
    const svg = toSVG(r.drawings);
    const g = svg.slice(svg.indexOf('<g id="chassis-bends"'), svg.indexOf("</g>", svg.indexOf('<g id="chassis-bends"')));
    expect(g).toContain('<path fill="none" d="M');
    expect(g).not.toContain("Z");
    expect(g.match(/<text /g)!.length).toBe(6);
  }, 30_000);
});
