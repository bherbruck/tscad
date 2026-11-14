/**
 * In-sketch patterns that stay constrained (mirror, circular, linear) and branch hints.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { compile, type Children } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);
const PI = Math.PI;

async function area(sk: Children) {
  const r = compile(<extrude height={1}>{sk}</extrude>);
  const e = await k.evaluate(r.document, { noMesh: true });
  const p = e.parts[0]!;
  if (!p.ok) throw new Error(JSON.stringify(p.error));
  return { area: p.volume!, r, info: r.sketches[0]! };
}
const near = (a: number, b: number) => expect(Math.abs(a - b) / b).toBeLessThan(1e-6);

describe("in-sketch patterns", () => {
  test("circular pattern of bolt holes, tied to the centre and the first hole", async () => {
    const { area: a, info, r } = await area(
      <sketch>
        <point id="o" fixed />
        <circle id="disc" center="o" r={40} />
        <circle id="hole" center="h" r={4} />
        <dimension a="o" b="h" dx={30} />
        <dimension a="o" b="h" dy={0} />
        <circularPattern center="o" count={6} of={["hole"]} />
      </sketch>,
    );
    expect(r.warnings).toEqual([]);
    expect(info.dof).toBe(0);
    near(a, PI * 1600 - 6 * PI * 16);
    const holes = info.entities.filter((e) => e.kind === "circle" && e.radius === 4) as Extract<(typeof info.entities)[number], { kind: "circle" }>[];
    expect(holes.length).toBe(6);
    expect(holes[2]!.center[0]).toBeCloseTo(30 * Math.cos((2 * PI) / 3), 9);
    expect(info.patterns).toEqual([{ kind: "circular", of: [1], copies: [[2], [3], [4], [5], [6]], center: [0, 0], angle: 60, loc: expect.anything() }]);
    expect(info.entities[3]!.copyOf).toEqual({ index: 1, pattern: 0, copy: 2 });
  }, 30_000);

  test("gasket: one lobe + one fillet, patterned three times round the centre", async () => {
    const s = 40, R = 12, rho = 10;
    const { area: a, info, r } = await area(
      <sketch>
        <point id="g" x={s / 2} y={(s * Math.sqrt(3)) / 6} fixed />
        <point id="c0" x={0} y={0} fixed />
        <arc id="L" center="c0" from="a0" to="b0" radius={R} />
        <arc id="F" from="b0" to="a0~1" tangent="L" radius={rho} cw />
        <circularPattern center="g" count={3} of={["L", "F"]} />
        <tangent a="F" b="L~1" />
      </sketch>,
    );
    expect(r.warnings).toEqual([]);
    expect(info.dof).toBe(0);
    const d = R + rho, hgt = Math.sqrt(d * d - (s / 2) ** 2), beta = Math.atan2(hgt, s / 2);
    const expected = (Math.sqrt(3) / 4) * s * s + 3 * (0.5 * s * hgt - 0.5 * rho * rho * (PI - 2 * beta)) + 1.5 * R * R * (2 * PI - PI / 3 - 2 * beta);
    near(a, expected);
  }, 30_000);

  test("mirror: a half profile mirrored about the axis closes and stays symmetric", async () => {
    const { area: a, info, r } = await area(
      <sketch>
        <point id="o" fixed />
        <line id="axis" from="o" to="top" vertical length={30} construction />
        <line id="base" from="o" to="p1" horizontal length={20} />
        <line id="side" from="p1" to="p2" length={25} />
        <line id="roof" from="p2" to="top" />
        <dimension a="o" b="p2" dy={20} />
        <mirrorEntities about="axis" of={["base", "side", "roof"]} />
      </sketch>,
    );
    expect(r.warnings).toEqual([]);
    expect(info.dof).toBe(0);
    // half: trapezoid-ish polygon o(0,0) p1(20,0) p2(x2,20) top(0,30)
    const x2 = 20 - Math.sqrt(25 * 25 - 20 * 20) * (info.points.find((p) => p.id === "p2")!.x < 20 ? 1 : -1);
    const half = 0.5 * Math.abs(0 * 0 - 20 * 0 + 20 * 20 - x2 * 0 + x2 * 30 - 0 * 20 + 0 - 0);
    near(a, 2 * half);
    const p2 = info.points.find((p) => p.id === "p2")!, p2m = info.points.find((p) => p.id === "p2'")!;
    expect([p2m.x, p2m.y]).toEqual([-p2.x, p2.y]);
    expect(info.patterns[0]!.kind).toBe("mirror");
  }, 30_000);
});

describe("branch hints", () => {
  const keyhole = (hint: "major" | "minor") => (
    <sketch>
      <point id="c" fixed />
      <point id="c2" />
      <vertical a="c" b="c2" />
      <dimension a="c2" b="c" dy={20} />
      <arc id="top" center="c" from="p" to="q" radius={8} {...{ [hint]: true }} />
      <line id="lineL" from="q" to="s" vertical />
      <arc id="bot" center="c2" from="s" to="t" radius={3} tangent="lineL" />
      <line id="lineR" from="t" to="p" vertical tangent="bot" />
    </sketch>
  );
  test("arc major / minor pick the long or short way", async () => {
    const yc = Math.sqrt(64 - 9), cap = 64 * Math.acos(yc / 8) - yc * Math.sqrt(64 - yc * yc);
    const major = await area(keyhole("major"));
    near(major.area, PI * 64 - cap + 6 * (20 - yc) + 4.5 * PI);
    const minor = await area(keyhole("minor"));
    expect(minor.r.warnings).toEqual([]);
    near(minor.area, cap + 6 * (20 + yc) + 4.5 * PI);
  }, 30_000);

  test("tangent side picks which side of the line the circle sits", async () => {
    const at = (side: "left" | "right") =>
      compile(
        <extrude height={1}>
          <sketch allowFree>
            <point id="o" fixed />
            <line id="base" from="o" to="e" horizontal length={50} construction />
            <circle id="c" center={[20, 8]} r={5} />
            <tangent a="base" b="c" side={side} />
          </sketch>
        </extrude>,
      ).sketches[0]!.entities.find((e) => e.id === "c") as { center: [number, number] };
    expect(at("left").center[1]).toBeCloseTo(5, 9);
    expect(at("right").center[1]).toBeCloseTo(-5, 9);
  });

  test('prefer="cw" draws an unguessed loop clockwise', () => {
    const tri = (prefer?: "cw") =>
      compile(
        <extrude height={1}>
          <sketch {...(prefer ? { prefer } : {})}>
            <point id="a" fixed />
            <line from="a" to="b" length={30} angle={0} />
            <line from="b" to="c" length={40} />
            <line from="c" to="a" length={50} />
          </sketch>
        </extrude>,
      ).sketches[0]!.points;
    const c = (pts: { id: string; y: number }[]) => pts.find((p) => p.id === "c")!.y;
    expect(c(tri())).toBeGreaterThan(0);
    expect(c(tri("cw"))).toBeLessThan(0);
  });
});

describe("linear pattern and the flange example", () => {
  test("linear pattern of slots along X", async () => {
    const lin = { of: ["hole"], count: 4, dx: 20 } as any;
    const { area: a, info } = await area(
      <sketch>
        <point id="o" fixed />
        <line from="o" to="a" horizontal length={90} />
        <line from="a" to="b" vertical length={20} />
        <line from="b" to="c" horizontal />
        <line from="c" to="o" vertical />
        <circle id="hole" center="h" r={3} />
        <dimension a="o" b="h" dx={15} />
        <dimension a="o" b="h" dy={10} />
        <linearPattern {...lin} />
      </sketch>,
    );
    expect(info.dof).toBe(0);
    near(a, 1800 - 4 * 9 * PI);
    expect(info.patterns[0]).toMatchObject({ kind: "linear", step: [20, 0] });
  }, 30_000);

  test("flange: mirrored lugs + bolt circle, fully constrained, evaluates", async () => {
    const { renderModule } = await import("tscad");
    const r = renderModule(await import("../examples/sketch-flange.tsx"));
    expect(r.warnings).toEqual([]);
    const s = r.sketches[0]!;
    expect(s.dof).toBe(0);
    expect(s.patterns.map((p) => p.kind).sort()).toEqual(["circular", "mirror"]);
    expect(s.entities.filter((e) => e.kind === "circle" && Math.abs(e.radius - 3.3) < 1e-9).length).toBe(6);
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.parts[0]!.ok).toBe(true);
    const [min, max] = e.parts[0]!.bbox!;
    expect(max[0] - min[0]).toBeCloseTo(2 * (62 + 10), 6);
  }, 30_000);
});
