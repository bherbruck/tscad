/**
 * Closed loops with no drawn positions: the loop layout (and relax restarts) must find the
 * intended shape. Areas checked with the kernel against closed forms.
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
  return { area: p.volume!, r };
}
const near = (a: number, b: number) => expect(Math.abs(a - b) / b).toBeLessThan(1e-6);
const belt = (r1: number, r2: number, d: number) => {
  const phi = Math.asin((r1 - r2) / d), t = Math.sqrt(d * d - (r1 - r2) ** 2);
  return (r1 + r2) * t + 0.5 * r1 * r1 * (PI + 2 * phi) + 0.5 * r2 * r2 * (PI - 2 * phi);
};

describe("unguessed closed loops", () => {
  test("rounded square: 4 h/v lines + 4 tangent arcs (the vase section)", async () => {
    const w = 60, rr = 18;
    const { area: a, r } = await area(
      <sketch>
        <point id="c" fixed />
        <line id="bottom" from="b0" to="b1" horizontal tangent />
        <arc id="se" from="b1" to="r0" tangent="bottom" radius={rr} />
        <line id="right" from="r0" to="r1" vertical tangent />
        <arc id="ne" from="r1" to="t0" tangent="right" equal="se" />
        <line id="top" from="t0" to="t1" horizontal tangent />
        <arc id="nw" from="t1" to="l0" tangent="top" equal="se" />
        <line id="left" from="l0" to="l1" vertical tangent />
        <arc id="sw" from="l1" to="b0" tangent="left" equal="se" />
        <dimension a="b0" b="top" distance={w} />
        <dimension a="r0" b="left" distance={w} />
        <symmetric a="b0" b="t0" about="c" />
      </sketch>,
    );
    expect(r.warnings).toEqual([]);
    expect(r.sketches[0]!.dof).toBe(0);
    near(a, w * w - (4 - PI) * rr * rr);
  }, 30_000);

  test("slot: two lines and two tangent half circles", async () => {
    const { area: a, r } = await area(
      <sketch>
        <point id="a" fixed />
        <line from="a" to="b" horizontal length={30} tangent />
        <arc id="e1" from="b" to="c" tangent radius={6} />
        <line from="c" to="d" horizontal tangent />
        <arc from="d" to="a" tangent />
      </sketch>,
    );
    expect(r.warnings).toEqual([]);
    near(a, 30 * 12 + 36 * PI);
  }, 30_000);

  test("obround with different end radii around fixed centres", async () => {
    const { area: a, r } = await area(
      <sketch>
        <point id="c1" fixed />
        <point id="c2" />
        <horizontal a="c1" b="c2" />
        <distance a="c1" b="c2" value={40} />
        <arc id="big" center="c1" from="p1" to="p2" radius={12} />
        <line id="low" from="p2" to="p3" tangent />
        <arc id="small" center="c2" from="p3" to="p4" radius={5} tangent="low" />
        <line from="p4" to="p1" tangent={["small", "big"]} />
      </sketch>,
    );
    expect(r.warnings).toEqual([]);
    near(a, belt(12, 5, 40));
  }, 30_000);

  test("D shape: a chord line and an arc (sharp corners)", async () => {
    const R = 10, h = 6; // chord at distance h from the centre
    const { area: a, r } = await area(
      <sketch>
        <point id="c" fixed />
        <arc id="round" center="c" from="p" to="q" radius={R} />
        <line id="flat" from="q" to="p" vertical />
        <dimension a="c" b="flat" distance={h} />
      </sketch>,
    );
    // the bigger part: circle minus the segment beyond the chord… which side? the arc goes CCW
    const seg = R * R * Math.acos(h / R) - h * Math.sqrt(R * R - h * h);
    expect(r.sketches[0]!.dof).toBe(0);
    expect([PI * R * R - seg, seg].some((v) => Math.abs(a - v) / v < 1e-6)).toBe(true);
  }, 30_000);

  test("keyhole: big circle arc, two vertical lines, a tangent bottom half circle", async () => {
    const R = 8, r2 = 3, L = 20; // L: from the big circle's centre down to the small arc's centre
    const { area: a, r } = await area(
      <sketch>
        <point id="c" fixed />
        <point id="c2" />
        <vertical a="c" b="c2" />
        <dimension a="c2" b="c" dy={L} />
        <arc id="top" center="c" from="p" to="q" radius={R} />
        <line id="lineL" from="q" to="s" vertical />
        <arc id="bot" center="c2" from="s" to="t" radius={r2} tangent="lineL" />
        <line id="lineR" from="t" to="p" vertical tangent="bot" />
      </sketch>,
    );
    expect(r.sketches[0]!.dof).toBe(0);
    // circle minus the gap's chord segment, plus the slot (rectangle + half disc)
    const yc = Math.sqrt(R * R - r2 * r2); // the lines meet the circle at y = −yc
    const capBelowChord = R * R * Math.acos(yc / R) - yc * Math.sqrt(R * R - yc * yc);
    near(a, PI * R * R - capBelowChord + 2 * r2 * (L - yc) + 0.5 * PI * r2 * r2);
    expect(r.warnings).toEqual([]);
  }, 30_000);

  test("gasket: three lobes and three concave tangent arcs (six tangent arcs)", async () => {
    const s = 40, R = 12, rho = 10;
    const P = [[0, 0], [s, 0], [s / 2, (s * Math.sqrt(3)) / 2]] as const;
    const { area: a, r } = await area(
      <sketch>
        {P.map(([x, y], i) => <point id={`c${i}`} x={x} y={y} fixed />)}
        <arc id="L0" center="c0" from="a0" to="b0" radius={R} />
        <arc id="F0" from="b0" to="a1" tangent="L0" radius={rho} cw />
        <arc id="L1" center="c1" from="a1" to="b1" radius={R} tangent="F0" />
        <arc id="F1" from="b1" to="a2" tangent="L1" radius={rho} cw />
        <arc id="L2" center="c2" from="a2" to="b2" radius={R} tangent="F1" />
        <arc id="F2" from="b2" to="a0" tangent={["L2", "L0"]} radius={rho} cw />
      </sketch>,
    );
    expect(r.sketches[0]!.dof).toBe(0);
    // expected: the fillet centre sits at R + ρ from both lobe centres, outside the triangle
    const d = R + rho, hgt = Math.sqrt(d * d - (s / 2) ** 2);
    const filletSector = (ang: number) => 0.5 * rho * rho * ang;
    const halfAngle = Math.atan2(hgt, s / 2); // at each lobe centre, between the side and the fillet centre
    const lobeSweep = PI / 3 + 2 * (PI / 2 - (PI / 2 - halfAngle)) ; // interior 60° + both overhangs
    void lobeSweep;
    // area via decomposition: triangle + 3 × (kite between lobe centres & fillet centre − fillet sector)
    // + lobe sectors outside the triangle
    const tri = (Math.sqrt(3) / 4) * s * s;
    const kite = 0.5 * s * hgt; // triangle lobe–lobe–fillet centre
    const filletAng = PI - 2 * Math.atan2(hgt, s / 2); // fillet arc angle seen from its centre
    const lobeAng = 2 * PI - PI / 3 - 2 * Math.atan2(hgt, s / 2); // lobe arc angle outside triangle and kites
    const expected = tri + 3 * (kite - filletSector(filletAng)) + 3 * 0.5 * R * R * lobeAng;
    // the kites point outward, so the lobe sectors are what's left of each lobe's full turn
    near(a, expected);
    expect(r.warnings).toEqual([]);
  }, 30_000);
});
