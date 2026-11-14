import { beforeAll, describe, expect, test } from "bun:test";
import { compile, type Children } from "tscad";
import { section, sectionToDXF, sectionToSVG, svgPathData, toDXF, toSVG } from "tscad/drawing";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";
import { polyline, signedArea, type Loop2 } from "../src/core/sketch/seg";
import { offsetLoops } from "../src/core/sketch/offset";
import { circleLoop, rectLoop, roundedRectLoop } from "../src/core/sketch/shapes";

const PI = Math.PI;
const drawing = (el: Children) => compile(el).drawings[0]!;
/** Exact signed area (lines and arcs; NURBS sampled): CCW +, CW −. */
const area = (loops: Loop2[]) =>
  loops.reduce(
    (acc, l) =>
      acc +
      l.reduce((a, s) => {
        if (s.kind === "line") return a + (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2;
        if (s.kind === "arc") {
          const [x0, y0, x1, y1] = [s.c[0] + s.r * Math.cos(s.a0), s.c[1] + s.r * Math.sin(s.a0), s.c[0] + s.r * Math.cos(s.a1), s.c[1] + s.r * Math.sin(s.a1)];
          return a + (s.c[0] * (y1 - y0) - s.c[1] * (x1 - x0) + s.r * s.r * (s.a1 - s.a0)) / 2;
        }
        return a + signedArea(polyline([s]));
      }, 0),
    0,
  );

/** Minimal DXF reader: [code, value] pairs → entities of the ENTITIES section. */
function readDXF(text: string) {
  const lines = text.trimEnd().split("\n");
  expect(lines.length % 2).toBe(0);
  const pairs: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]!.trim()]);
  expect(pairs[pairs.length - 1]).toEqual([0, "EOF"]);
  const start = pairs.findIndex(([c, v], i) => c === 2 && v === "ENTITIES" && pairs[i - 1]![1] === "SECTION");
  const ents: { type: string; g: Map<number, string[]> }[] = [];
  for (let i = start + 1; i < pairs.length; i++) {
    const [c, v] = pairs[i]!;
    if (c === 0) {
      if (v === "ENDSEC") break;
      ents.push({ type: v, g: new Map() });
    } else {
      const e = ents[ents.length - 1]!;
      (e.g.get(c) ?? e.g.set(c, []).get(c)!).push(v);
    }
  }
  const header = new Map<string, string>();
  for (let i = 0; i < pairs.length && pairs[i]![1] !== "ENDSEC"; i++) if (pairs[i]![0] === 9) header.set(pairs[i]![1], pairs[i + 1]![1]);
  return { ents, header, count: (t: string) => ents.filter((e) => e.type === t).length };
}

describe("<offset>", () => {
  test("exact areas", () => {
    const off = (loops: Loop2[], d: number, round = true) => area(offsetLoops(loops, d, round));
    expect(off([rectLoop(20, 10)], 2)).toBeCloseTo(200 + 60 * 2 + PI * 4, 3);
    expect(off([rectLoop(20, 10)], 2, false)).toBeCloseTo(24 * 14, 9);
    expect(off([rectLoop(20, 10)], -2)).toBeCloseTo(16 * 6, 9);
    expect(off([circleLoop(5)], 1)).toBeCloseTo(PI * 36, 9);
    expect(off([roundedRectLoop(20, 10, 3)], -4)).toBeCloseTo(24, 9); // corners collapse to sharp
    expect(off([rectLoop(40, 30), circleLoop(5)], 1)).toBeCloseTo(42 * 32 - 4 + PI - PI * 16, 3);
    expect(offsetLoops([rectLoop(40, 30), circleLoop(1)], 2).length).toBe(1); // the hole closed up
    expect(offsetLoops([rectLoop(4, 4)], -3)).toEqual([]); // shrank away
  });
  test("arcs stay exact; offsets compose in JSX", () => {
    const d = drawing(<drawing><offset distance={2}><rect w={20} h={10} /></offset></drawing>);
    expect(d.loops[0]!.filter((s) => s.kind === "arc").map((s) => (s as any).r)).toEqual([2, 2, 2, 2]);
    expect(() => compile(<drawing><offset distance={3}><polygon points={[[0, 0], [10, 0], [10, 10], [5.5, 10], [5.5, 2], [4.5, 2], [4.5, 10], [0, 10]]} /></offset></drawing>)).toThrow(/cross itself|inside out|fold over/);
  });
  test("an offset plate in the kernel", async () => {
    const k = await loadKernel();
    const r = await k.evaluate(compile(<extrude height={2}><offset distance={1}><rect w={40} h={30} /><circle r={5} /></offset></extrude>).document, { noMesh: true });
    expect(r.parts[0]!.volume!).toBeCloseTo((42 * 32 - 4 + PI - PI * 16) * 2, 3);
  }, 30_000);
});

describe("<drawing>", () => {
  test("loops without the kernel: outer CCW, holes CW; not a part without thickness", () => {
    const r = compile(<drawing name="plate"><rect w={40} h={30} /><circle r={5} /></drawing>);
    expect(r.document.parts).toEqual([]);
    const d = r.drawings[0]!;
    expect(d.name).toBe("plate");
    expect(d.loops.map((l) => Math.sign(signedArea(polyline(l))))).toEqual([1, -1]);
    expect(area(d.loops)).toBeCloseTo(1200 - PI * 25, 2);
  });
  test("thickness makes it a part too; placement applies", async () => {
    const r = compile(
      <assembly>
        <drawing name="gasket" thickness={1.5} material="tpu" x={100}>
          <rect w={50} h={30} />
          <circle r={8} />
        </drawing>
        <drawing name="gasket"><circle r={1} /></drawing>
      </assembly>,
    );
    expect(r.drawings.map((d) => d.name)).toEqual(["gasket", "gasket-2"]);
    expect(r.parts[0]).toMatchObject({ name: "gasket", material: "tpu" });
    const k = await loadKernel();
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.parts[0]!.volume!).toBeCloseTo((1500 - PI * 64) * 1.5, 3);
    expect(e.parts[0]!.bbox![0][0]).toBeCloseTo(75);
  }, 30_000);
  test("drawings can't hold solids", () => {
    expect(() => compile(<drawing><box size={1} /></drawing>)).toThrow(/is a solid/);
  });
});

describe("DXF", () => {
  test("R12 structure, mm, LINE + CIRCLE", () => {
    const dxf = toDXF(compile(<drawing name="plate"><rect w={40} h={30} /><circle r={5} /></drawing>).drawings);
    const { count, header, ents } = readDXF(dxf);
    expect(header.get("$ACADVER")).toBe("AC1009");
    expect(header.get("$INSUNITS")).toBe("4");
    expect(count("LINE")).toBe(4);
    expect(count("CIRCLE")).toBe(1);
    expect(ents.every((e) => e.g.get(8)?.[0] === "PLATE")).toBe(true);
    const c = ents.find((e) => e.type === "CIRCLE")!;
    expect(c.g.get(40)).toEqual(["5"]);
  });
  test("real ARCs with CCW angles", () => {
    const { ents, count } = readDXF(toDXF(drawing(<drawing><roundedRect w={20} h={10} r={3} /></drawing>)));
    expect(count("ARC")).toBe(4);
    expect(count("LINE")).toBe(4);
    const angles = ents.filter((e) => e.type === "ARC").map((e) => [Number(e.g.get(50)![0]), Number(e.g.get(51)![0])]);
    expect(angles).toEqual([[270, 0], [0, 90], [90, 180], [180, 270]]);
    // a hole (CW) still writes CCW ARC angles
    const hole = readDXF(toDXF(drawing(<drawing><rect w={50} h={50} /><roundedRect w={20} h={10} r={3} /></drawing>)));
    expect(hole.ents.filter((e) => e.type === "ARC").map((e) => [Number(e.g.get(50)![0]), Number(e.g.get(51)![0])]).sort()).toEqual([[0, 90], [180, 270], [270, 0], [90, 180]].sort());
  });
  test("polyline mode: one closed POLYLINE per loop with bulges", () => {
    const { ents, count } = readDXF(toDXF(drawing(<drawing><roundedRect w={20} h={10} r={3} /><circle r={2} /></drawing>), { entities: "polyline" }));
    expect(count("POLYLINE")).toBe(2);
    expect(count("SEQEND")).toBe(2);
    const bulges = ents.filter((e) => e.type === "VERTEX").flatMap((e) => e.g.get(42) ?? []).map(Number);
    expect(bulges.filter((b) => Math.abs(b - Math.tan(PI / 8)) < 1e-6).length).toBe(4); // quarter arcs, CCW
    expect(bulges.filter((b) => Math.abs(b + 1) < 1e-6).length).toBe(2); // the CW hole circle in two halves
  });
  test("NURBS (text) become flattened POLYLINEs", () => {
    const { count } = readDXF(toDXF(drawing(<drawing><text size={10}>o</text></drawing>)));
    expect(count("POLYLINE")).toBeGreaterThan(0);
  });
});

describe("SVG", () => {
  test("path data matches the loops (y flipped, true arcs)", () => {
    const d = drawing(<drawing><rect w={4} h={2} /><circle r={0.5} /></drawing>);
    expect(svgPathData(d.loops)).toBe("M-2 1L2 1L2 -1L-2 -1L-2 1Z M0.5 0A0.5 0.5 0 0 1 -0.5 0A0.5 0.5 0 0 1 0.5 0Z");
    const svg = toSVG(d);
    expect(svg).toContain(`width="6mm" height="4mm" viewBox="-3 -2 6 4"`);
    expect(svg).toContain(`fill-rule="evenodd"`);
  });
  test("quadratic text curves stay Q", () => {
    expect(svgPathData(drawing(<drawing><text>o</text></drawing>).loops)).toContain("Q");
  });
});

describe("mesh sections", () => {
  let k: KernelHost;
  beforeAll(async () => {
    k = await loadKernel();
  }, 30_000);
  async function mesh(el: Children) {
    await k.evaluate(compile(<part name="s">{el}</part>).document);
    return (await k.mesh("s"))!;
  }
  test("a box sliced at z = 2 is a rectangle", async () => {
    const m = await mesh(<box size={[20, 10, 5]} />);
    const r = section(m, { origin: [0, 0, 2], normal: [0, 0, 1] });
    expect(r.open).toEqual([]);
    expect(r.loops.length).toBe(1);
    expect(r.loops[0]!.length).toBe(4);
    expect(Math.abs(signedArea(r.loops[0]!))).toBeCloseTo(200, 3);
    const xs = r.loops[0]!.map((p) => p[0]).sort((a, b) => a - b);
    expect([xs[0], xs[3]]).toEqual([-10, 10]);
  }, 30_000);
  test("a plate with a hole gives two loops; side sections work", async () => {
    const m = await mesh(<extrude height={5}><rect w={40} h={30} /><circle r={5} /></extrude>);
    const r = section(m, { origin: [0, 0, 2.5], normal: [0, 0, 1] });
    expect(r.loops.length).toBe(2);
    const areas = r.loops.map((l) => Math.abs(signedArea(l))).sort((a, b) => a - b);
    expect(areas[1]).toBeCloseTo(1200, 3);
    expect(areas[0]).toBeGreaterThan(PI * 25 * 0.98);
    const side = section(m, { origin: [0, 0, 0], normal: [1, 0, 0] });
    expect(side.loops.length).toBe(2); // the hole splits the x = 0 slice in two
    expect(readDXF(sectionToDXF(m, { origin: [0, 0, 2.5], normal: [0, 0, 1] }, { entities: "polyline" })).count("POLYLINE")).toBe(2);
    expect(sectionToSVG(m, { origin: [0, 0, 2.5], normal: [0, 0, 1] })).toContain("<path");
  }, 30_000);
});
