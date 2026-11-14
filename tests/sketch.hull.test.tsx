/**
 * Exact 2D convex hulls: structure (true arcs + tangents) and kernel areas vs closed forms.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { compile, type Children } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";
import { hullLoops } from "../src/core/sketch/hull";
import { circleLoop, rectLoop } from "../src/core/sketch/shapes";
import { closureGap } from "../src/core/sketch/seg";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);
const PI = Math.PI;

async function volume(el: Children): Promise<number> {
  const e = await k.evaluate(compile(el).document, { noMesh: true });
  const p = e.parts[0]!;
  if (!p.ok) throw new Error(JSON.stringify(p.error));
  return p.volume!;
}
const near = (a: number, b: number) => expect(Math.abs(a - b) / b).toBeLessThan(1e-6);
/** Belt around two circles r1, r2 with centres d apart. */
const belt = (r1: number, r2: number, d: number) => {
  const phi = Math.asin((r1 - r2) / d), t = Math.sqrt(d * d - (r1 - r2) ** 2);
  return (r1 + r2) * t + 0.5 * r1 * r1 * (PI + 2 * phi) + 0.5 * r2 * r2 * (PI - 2 * phi);
};

describe("hull structure", () => {
  test("two circles → arc, tangent, arc, tangent; closed exactly", () => {
    const h = hullLoops([circleLoop(5, [0, 0]), circleLoop(5, [20, 0])]);
    expect(h.map((s) => s.kind)).toEqual(["arc", "line", "arc", "line"]);
    expect(closureGap(h).gap).toBeLessThan(1e-12);
    const a = h.find((s) => s.kind === "arc")!;
    expect(a.kind === "arc" && a.r).toBe(5);
  });
  test("polygons stay polygons; inner points vanish", () => {
    const h = hullLoops([rectLoop(10, 10), rectLoop(2, 2, 1, 1), rectLoop(10, 10, 5, 5)]);
    expect(h.every((s) => s.kind === "line")).toBe(true);
    expect(h.length).toBe(6);
  });
  test("flat input is an error", () => {
    expect(() => hullLoops([[{ kind: "line", a: [0, 0], b: [10, 0] }, { kind: "line", a: [10, 0], b: [0, 0] }]])).toThrow(/flat/);
  });
});

describe("hull areas in the kernel", () => {
  const cases: [string, Children, number][] = [
    ["two circles = stadium", <extrude height={1}><hull><circle r={5} /><circle r={5} x={20} /></hull></extrude>, 200 + 25 * PI],
    ["three equal circles = rounded triangle", <extrude height={1}><hull><circle r={2} /><circle r={2} x={10} /><circle r={2} x={5} y={5 * Math.sqrt(3)} /></hull></extrude>, (Math.sqrt(3) / 4) * 100 + 30 * 2 + 4 * PI],
    ["circle + point = teardrop", <extrude height={1}><hull><circle r={5} /><polygon points={[[20, 0], [20, 0.000001], [19.999999, 0]]} /></hull></extrude>, 5 * Math.sqrt(375) + 25 * (PI - Math.acos(0.25))],
    ["unequal circles = cam / belt", <extrude height={2}><hull><circle r={10} /><circle r={4} x={25} /></hull></extrude>, 2 * belt(10, 4, 25)],
    ["hull of rect + circle (rounded end)", <extrude height={1}><hull><rect w={10} h={10} /><circle r={5} x={10} /></hull></extrude>, 100 + 5 * 10 + 12.5 * PI],
    ["hull with a hole inside is solid", <extrude height={1}><hull><circle r={5} /><circle r={5} x={20} /><circle r={2} x={10} /></hull><circle r={1} x={10} /></extrude>, 200 + 25 * PI - PI],
    ["revolved hull (capsule ring)", <revolve><hull><circle r={2} x={10} /><circle r={2} x={10} y={10} /></hull></revolve>, 2 * PI * 10 * (40 + 4 * PI)],
    ["placed hull in a sketch", <extrude height={1}><hull x={100} rotate={30}><circle r={5} /><circle r={5} x={20} /></hull></extrude>, 200 + 25 * PI],
  ];
  for (const [name, el, expected] of cases) test(name, async () => near(await volume(el), expected), 30_000);
});
