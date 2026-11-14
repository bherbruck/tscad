import { beforeAll, describe, expect, test } from "bun:test";
import { compile, type Children, type Node } from "tscad";
import {
  BoltPattern, CounterboreHole, CountersinkHole, Extrusion2020, extrusion2020Outline, HeatSetInsert, HexPrism, Hole,
  metric, MountHoles, mountPatterns, NutTrap, Standoff, TapHole,
} from "tscad/parts";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

const PI = Math.PI;
const ir = (el: Children): Node => compile(el).document.parts![0]!.node;
const hexArea = (af: number) => (Math.sqrt(3) / 2) * af * af;
const frustum = (r1: number, r2: number, h: number) => (PI * h * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
function shoelace(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i]![0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * p[i]![1];
  return Math.abs(a) / 2;
}

describe("metric data", () => {
  test("ISO values", () => {
    expect(metric.M3.clearance).toEqual({ close: 3.2, normal: 3.4, loose: 3.6 });
    expect(metric.M4.tapDrill).toBe(3.3);
    expect(metric.M3.socketHead).toEqual({ diameter: 5.5, height: 3 });
    expect(metric.M8.nut.af).toBe(13);
    expect(metric.M3.countersunk.diameter).toBe(6.72);
  });
});

describe("IR", () => {
  test("holes are tools pointing -Z from z = 0", () => {
    const n = ir(<Hole size="M3" depth={5} />) as any;
    expect(n.type).toBe("transform");
    expect(n.matrix[11]).toBe(-5);
    expect(n.children[0]).toEqual({ type: "cylinder", radius: 1.7, height: 5.01 });
    expect((ir(<Hole size="M3" fit="close" depth={5} />) as any).children[0].radius).toBe(1.6);
    expect((ir(<TapHole size="M4" />) as any).children[0].radius).toBe(1.65);
  });
  test("placement props pass through", () => {
    const n = ir(<Hole size="M3" depth={5} x={10} z={6} />) as any;
    expect([n.matrix[3], n.matrix[11]]).toEqual([10, 6]);
  });
  test("BoltPattern repeats children at the pattern points", () => {
    const n = ir(<BoltPattern pattern={mountPatterns.nema17}><sphere r={1} /></BoltPattern>) as any;
    expect(n.type).toBe("union");
    expect(n.children.map((c: any) => [c.matrix[3], c.matrix[7]])).toEqual([[-15.5, -15.5], [15.5, -15.5], [15.5, 15.5], [-15.5, 15.5]]);
    expect((ir(<BoltPattern pattern={[[1, 2]]}><sphere r={1} /></BoltPattern>) as any).matrix[7]).toBe(2);
  });
  test("patterns: published dimensions", () => {
    const span = (p: readonly (readonly [number, number])[]) => [Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1]))];
    expect(span(mountPatterns.raspberryPi4.points)).toEqual([58, 49]);
    expect(span(mountPatterns.nema23.points)).toEqual([47.14, 47.14]);
    const corner = mountPatterns.arduinoUno.outlineOffset;
    expect(mountPatterns.arduinoUno.points.map(([x, y]) => [+(x - corner[0]).toFixed(2), +(y - corner[1]).toFixed(2)])).toEqual([[13.97, 2.54], [15.24, 50.8], [66.04, 7.62], [66.04, 35.56]]);
  });
  test("bad input", () => {
    expect(() => compile(<Hole size={"M7" as any} />)).toThrow(/unknown metric size "M7"/);
    expect(() => compile(<Standoff size="M3" height={-1} />)).toThrow(/height must be/);
    expect(() => compile(<HeatSetInsert size="M12" />)).toThrow(/no default insert/);
  });
});

describe("kernel", () => {
  let k: KernelHost;
  beforeAll(async () => {
    k = await loadKernel();
  }, 30_000);
  async function volume(el: Children): Promise<number> {
    const r = await k.evaluate(compile(<part name="p">{el}</part>).document, { noMesh: true });
    const p = r.parts[0]!;
    if (!p.ok) throw new Error(JSON.stringify(p.error));
    return p.volume!;
  }
  const block = (h: number, tool: Children) => (
    <difference>
      <box size={[20, 20, h]} />
      {tool}
    </difference>
  );
  const cases: [string, () => Children, number][] = [
    ["Hole", () => block(5, <Hole size="M3" depth={5} z={5} />), 2000 - PI * 1.7 ** 2 * 5],
    ["CounterboreHole", () => block(6, <CounterboreHole size="M3" depth={6} z={6} />), 2400 - PI * (1.7 ** 2 * 2.6 + 3.25 ** 2 * 3.4)],
    ["CountersinkHole", () => block(6, <CountersinkHole size="M3" depth={6} z={6} />), 2400 - PI * 1.7 ** 2 * (6 - 1.66) - frustum(1.7, 3.36, 1.66)],
    ["TapHole", () => block(10, <TapHole size="M4" z={10} />), 4000 - PI * 1.65 ** 2 * 10],
    ["NutTrap", () => block(5, <NutTrap size="M3" z={5} boltDepth={2.4} />), 2000 - hexArea(5.8) * 2.6 - PI * 1.7 ** 2 * 2.4],
    ["HeatSetInsert", () => block(10, <HeatSetInsert size="M3" z={10} />), 4000 - PI * 4 * 6.2],
    ["Standoff", () => <Standoff size="M3" height={10} />, PI * (3.5 ** 2 - 1.25 ** 2) * 10],
    ["Standoff hex insert", () => <Standoff size="M3" height={10} hex hole="insert" />, hexArea(7) * 10 - PI * 4 * 6.2],
    ["HexPrism", () => <HexPrism af={10} height={5} bore={4} />, (hexArea(10) - PI * 4) * 5],
    ["Extrusion2020", () => <Extrusion2020 length={10} />, (shoelace(extrusion2020Outline) - PI * 2.1 ** 2) * 10],
    ["MountHoles (Pi 4)", () => block(3, <MountHoles pattern={{ ...mountPatterns.raspberryPi4, points: [[0, 0]] }} depth={3} z={3} />), 1200 - PI * 1.45 ** 2 * 3],
  ];
  for (const [name, el, expected] of cases) {
    test(name, async () => {
      expect(Math.abs((await volume(el())) - expected) / expected).toBeLessThan(1e-4);
    }, 30_000);
  }
});
