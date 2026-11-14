/**
 * Constraint-sketch solver: geometry from constraints, DOF and conflict diagnostics.
 */
import { describe, expect, test } from "bun:test";
import type { Children } from "tscad";
import { TscadError } from "../src/core/errors";
import { render } from "../src/core/render";
import { solveSketch, type SketchEntityInfo } from "../src/core/sketch/constrained";
import { lm, analyze, type System } from "../src/core/sketch/solver/solve";
import * as d from "../src/core/sketch/solver/dual";

function solve(el: Children) {
  const warnings: string[] = [];
  const [host] = render(el, { warnings });
  const r = solveSketch(host!, { warn: (_h, m) => warnings.push(m) });
  const pt = (id: string) => {
    const p = r.info.points.find((q) => q.id === id);
    if (!p) throw new Error(`no point ${id}`);
    return [p.x, p.y] as [number, number];
  };
  const ent = (id: string) => r.info.entities.find((e) => e.id === id) as SketchEntityInfo;
  return { ...r, warnings, pt, ent };
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
const close = (a: number[], b: number[], tol = 1e-8) => expect(dist(a, b)).toBeLessThan(tol);

describe("solver core", () => {
  test("LM finds a circle–line intersection with min-norm steps", () => {
    // x² + y² = 25, y = 3 → (4, 3) from (3, 3.5)
    const sys: System = {
      x0: Float64Array.from([3, 3.5]),
      scale: 5,
      constraints: [
        { label: "circle", vars: [0, 1], eval: ([x, y]) => [d.addc(d.add(d.mul(x!, x!), d.mul(y!, y!)), -25)] },
        { label: "line", vars: [1], eval: ([y]) => [d.addc(y!, -3)] },
      ],
    };
    const r = lm(sys, [0, 1]);
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(4, 10);
    expect(r.x[1]).toBeCloseTo(3, 10);
    expect(analyze(sys, r.x, [0, 1]).dof).toBe(0);
  });
});

describe("constraint sketches", () => {
  test("triangle from three lengths", () => {
    const s = solve(
      <sketch>
        <point id="a" x={0} y={0} fixed />
        <line id="ab" from="a" to="b" horizontal length={30} />
        <line id="bc" from="b" to="c" length={40} />
        <line id="ca" from="c" to="a" length={50} />
      </sketch>,
    );
    close(s.pt("b"), [30, 0]);
    expect(dist(s.pt("b"), s.pt("c"))).toBeCloseTo(40, 9);
    expect(dist(s.pt("c"), s.pt("a"))).toBeCloseTo(50, 9);
    expect(s.info.dof).toBe(0);
    expect(s.info.status).toBe("ok");
    expect(s.warnings).toEqual([]);
    expect(s.loops.length).toBe(1);
    expect(s.loops[0]!.length).toBe(3);
  });

  test("rectangle from horizontal/vertical/length", () => {
    const s = solve(
      <sketch>
        <point id="o" x={0} y={0} fixed />
        <line from="o" to="a" horizontal length={40} />
        <line from="a" to="b" vertical length={20} />
        <line from="b" to="c" horizontal />
        <line from="c" to="o" vertical />
      </sketch>,
    );
    close(s.pt("a"), [40, 0]);
    close(s.pt("b"), [40, 20]);
    close(s.pt("c"), [0, 20]);
    expect(s.info.dof).toBe(0);
  });

  test("tangent arc continuation (a U shape)", () => {
    const s = solve(
      <sketch>
        <point id="o" x={0} y={0} fixed />
        <line id="base" from="o" to="a" horizontal length={20} />
        <line id="right" from="a" to="b" vertical length={30} />
        <arc id="top" from="b" to="c" tangent="right" radius={10} />
        <line id="left" from="c" to="o" tangent />
      </sketch>,
    );
    expect(s.warnings).toEqual([]);
    close(s.pt("b"), [20, 30]);
    close(s.pt("c"), [0, 30]);
    const top = s.ent("top") as Extract<SketchEntityInfo, { kind: "arc" }>;
    close(top.center, [10, 30]);
    expect(top.ccw).toBe(true);
    expect(s.info.dof).toBe(0);
  });

  test("circle tangent to two lines", () => {
    const s = solve(
      <sketch>
        <point id="o" x={0} y={0} fixed />
        <line id="h" from="o" to="a" horizontal length={50} construction />
        <line id="v" from="o" to="b" vertical length={50} construction />
        <circle id="c" center={[10, 12]} r={8} tangent={["h", "v"]} />
      </sketch>,
    ).info;
    const c = s.entities.find((e) => e.id === "c") as Extract<SketchEntityInfo, { kind: "circle" }>;
    close(c.center, [8, 8]);
  });

  test("symmetric about a point's vertical axis, and a point–line dimension", () => {
    const s = solve(
      <sketch>
        <point id="o" x={0} y={0} fixed />
        <line id="base" from="o" to="a" horizontal length={60} construction />
        <point id="h" x={25} y={15} />
        <symmetric a="o" b="a" about="h" axis="x" />
        <dimension a="h" b="base" distance={24} />
        <circle center="h" r={5} />
      </sketch>,
    );
    close(s.pt("h"), [30, 24]);
  });

  test("angle between lines and a fixed angle", () => {
    const s = solve(
      <sketch>
        <point id="o" x={0} y={0} fixed />
        <line id="l1" from="o" to="a" angle={0} length={10} />
        <line id="l2" from="o" to="b" length={10} />
        <angle a="l1" b="l2" value={35} />
        <line from="a" to="b" />
      </sketch>,
    );
    const b = s.pt("b");
    close(b, [10 * Math.cos(35 * Math.PI / 180), 10 * Math.sin(35 * Math.PI / 180)]);
    expect(s.info.dof).toBe(0);
    expect(s.info.dimensions.map((x) => x.text)).toEqual(["10", "0°", "10", "35°"]);
  });

  test("under-constrained sketch warns with the free points and stays where drawn", () => {
    const s = solve(
      <sketch>
        <point id="o" x={0} y={0} fixed />
        <line from="o" to="a" horizontal length={30} />
        <line from="a" to="b" />
        <line from="b" to="o" />
        <point id="b" x={10} y={12} />
      </sketch>,
    );
    expect(s.info.status).toBe("under");
    expect(s.info.dof).toBe(2);
    expect(s.info.free).toEqual(['point "b"']);
    close(s.pt("b"), [10, 12]);
    expect(s.warnings.join("\n")).toContain('under-constrained: 2 degrees of freedom remain (free: point "b")');
  });

  test("conflicting constraints are an error naming both, with source lines", () => {
    let err: TscadError | undefined;
    try {
      solve(
        <sketch>
          <point id="o" x={0} y={0} fixed />
          <line id="base" from="o" to="a" horizontal length={40} />
          <dimension a="o" b="a" distance={50} />
        </sketch>,
      );
    } catch (e) {
      err = e as TscadError;
    }
    expect(err).toBeInstanceOf(TscadError);
    expect(err!.detail).toContain('over-constrained: <dimension a="o" b="a" distance=50> conflicts with length=40 on line "base"');
    expect(err!.detail).toMatch(/sketch\.solver\.test\.tsx:\d+/);
    expect(err!.loc?.file).toContain("sketch.solver.test.tsx");
  });

  test("impossible triangle is reported", () => {
    expect(() =>
      solve(
        <sketch>
          <point id="a" x={0} y={0} fixed />
          <line from="a" to="b" horizontal length={10} />
          <line id="bc" from="b" to="c" length={3} />
          <line id="ca" from="c" to="a" length={3} />
        </sketch>,
      ),
    ).toThrow(/over-constrained/);
  });

  test("redundant constraints warn", () => {
    const s = solve(
      <sketch>
        <point id="o" x={0} y={0} fixed />
        <line id="base" from="o" to="a" horizontal length={40} />
        <horizontal a="o" b="a" />
        <line from="a" to="b" vertical length={10} />
        <line from="b" to="o" />
      </sketch>,
    );
    expect(s.warnings.some((w) => w.includes('redundant constraint: <horizontal a="o" b="a"> is already implied by horizontal on line "base"'))).toBe(true);
  });

  test("unknown references suggest names", () => {
    expect(() =>
      solve(
        <sketch>
          <point id="origin" fixed />
          <line id="base" from="origin" to="a" />
          <dimension a="orign" b="a" distance={5} />
        </sketch>,
      ),
    ).toThrow(/unknown point "orign"[\s\S]*did you mean "origin"/);
  });

  test("open profile is an error at the dangling curve", () => {
    expect(() =>
      solve(
        <sketch>
          <point id="o" fixed />
          <line from="o" to="a" horizontal length={5} />
          <line from="a" to="b" vertical length={5} />
        </sketch>,
      ),
    ).toThrow(/open profile/);
  });
});
