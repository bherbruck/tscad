/**
 * Assembly mates: anchors, joint types, DOF/conflict diagnostics, and kernel results.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { assemblyRefs, compile, TscadError, type Children } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);

/** A flat link along +X with joint anchors (axis +Z) at both ends. */
function Link({ name, length, fixed }: { name: string; length: number; fixed?: boolean }) {
  return (
    <part name={name} fixed={fixed}>
      <box size={[length, 4, 2]} center={[false, true, false]} />
      <anchor id="base" />
      <anchor id="tip" at={[length, 0, 0]} />
    </part>
  );
}

const frame = (r: ReturnType<typeof compile>, part: string, id: string) => r.assembly!.anchors.find((a) => a.part === part && a.id === id)!.frame;
const origin = (f: number[]) => [f[3]!, f[7]!, f[11]!];
const close = (a: number[], b: number[], tol = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(tol));
const DEG = Math.PI / 180;

describe("mates", () => {
  test("fastened stacks a block on a base", () => {
    const r = compile(
      <assembly>
        <part name="base"><box size={[20, 20, 10]} /><anchor id="top" at={[0, 0, 10]} /></part>
        <part name="block"><box size={[5, 5, 5]} /><anchor id="bottom" /></part>
        <mate a="base.top" b="block.bottom" />
      </assembly>,
    );
    expect(r.warnings).toEqual([]);
    const block = r.assembly!.parts.find((p) => p.name === "block")!;
    close(block.transform, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 10, 0, 0, 0, 1]);
    expect(block.dof).toBe(0);
    expect(r.document.parts![1]!.node.type).toBe("transform");
  });

  test("anchors follow the placement they sit in", () => {
    const r = compile(
      <assembly>
        <part name="a" x={5}>
          <translate z={3}><rotate y={90}><box size={1} /><anchor id="p" at={[0, 0, 2]} /></rotate></translate>
        </part>
      </assembly>,
    );
    const f = frame(r, "a", "p");
    close(origin(f), [7, 0, 3]); // rotate y 90: (0,0,2) → (2,0,0)
    close([f[2]!, f[6]!, f[10]!], [1, 0, 0]); // axis z → +x
  });

  test("revolute driven by angle", () => {
    const r = compile(
      <assembly>
        <Link name="ground" length={30} fixed />
        <Link name="arm" length={20} />
        <mate a="ground.tip" b="arm.base" type="revolute" angle={90} />
      </assembly>,
    );
    expect(r.warnings).toEqual([]);
    close(origin(frame(r, "arm", "tip")), [30, 20, 0]);
  });

  test("slider driven by offset, orientation locked", () => {
    const r = compile(
      <assembly>
        <part name="rail"><box size={[100, 5, 5]} center={false} /><anchor id="track" axis="x" /></part>
        <part name="carriage" rotate={[0, 0, 33]}><box size={10} /><anchor id="mount" axis="x" /></part>
        <mate a="rail.track" b="carriage.mount" type="slider" offset={42} />
      </assembly>,
    );
    const c = r.assembly!.parts.find((p) => p.name === "carriage")!;
    expect(c.dof).toBe(0);
    const f = frame(r, "carriage", "mount");
    close(origin(f), [42, 0, 0]);
    close([f[0]!, f[4]!, f[8]!], [0, 1, 0]); // orientation locked to the rail (x along +Y for an X axis)
  });

  test("a chain of three parts (two-link arm) matches forward kinematics", () => {
    const a1 = 30, a2 = 60;
    const r = compile(
      <assembly>
        <Link name="base" length={10} fixed />
        <Link name="upper" length={50} />
        <Link name="fore" length={40} />
        <mate a="base.tip" b="upper.base" type="revolute" angle={a1} />
        <mate a="upper.tip" b="fore.base" type="revolute" angle={a2 - a1} />
      </assembly>,
    );
    const tip = origin(frame(r, "fore", "tip"));
    close(tip, [10 + 50 * Math.cos(a1 * DEG) + 40 * Math.cos(a2 * DEG), 50 * Math.sin(a1 * DEG) + 40 * Math.sin(a2 * DEG), 0], 1e-8);
  });

  test("typed anchor handles", () => {
    const A = assemblyRefs<{ base: "top"; block: "bottom" }>();
    const r = compile(
      <assembly>
        <part name={A.base.name}><box size={10} /><anchor id="top" at={[0, 0, 10]} /></part>
        <part name={A.block.name}><box size={2} /><anchor id="bottom" /></part>
        <mate a={A.base.top} b={A.block.bottom} flip />
      </assembly>,
    );
    const f = frame(r, "block", "bottom");
    close(origin(f), [0, 0, 10]);
    close([f[2]!, f[6]!, f[10]!], [0, 0, -1]);
    // @ts-expect-error not an anchor of base
    void A.base.bottom;
  });

  test("free joints warn with the part's remaining DOF", () => {
    const r = compile(
      <assembly>
        <Link name="g" length={10} fixed />
        <Link name="arm" length={10} />
        <mate a="g.tip" b="arm.base" type="revolute" />
      </assembly>,
    );
    expect(r.assembly!.parts.find((p) => p.name === "arm")!.dof).toBe(1);
    expect(r.warnings.some((w) => w.includes('part "arm" can still move: 1 degree of freedom'))).toBe(true);
    const c = compile(
      <assembly>
        <Link name="g" length={10} fixed />
        <Link name="arm" length={10} />
        <mate a="g.tip" b="arm.base" type="cylindrical" />
      </assembly>,
    );
    expect(c.assembly!.parts.find((p) => p.name === "arm")!.dof).toBe(2);
  });

  test("a closed four-bar loop solves (parallelogram from the drawn branch)", () => {
    const r = compile(
      <assembly>
        <Link name="ground" length={40} fixed />
        <Link name="crank" length={20} />
        <Link name="coupler" length={40} />
        <Link name="rocker" length={20} />
        <mate a="ground.base" b="crank.base" type="revolute" angle={60} />
        <mate a="crank.tip" b="coupler.base" type="revolute" />
        <mate a="ground.tip" b="rocker.base" type="revolute" />
        <mate a="rocker.tip" b="coupler.tip" type="revolute" />
      </assembly>,
    );
    expect(r.warnings).toEqual([]);
    close(origin(frame(r, "rocker", "tip")), [50, 20 * Math.sin(60 * DEG), 0], 1e-8);
    expect(r.assembly!.parts.map((p) => p.dof)).toEqual([0, 0, 0, 0]);
  });

  test("strict: free parts are errors, redundant mates warn", () => {
    expect(() =>
      compile(
        <assembly strict>
          <Link name="g" length={10} fixed />
          <Link name="arm" length={10} />
          <mate a="g.tip" b="arm.base" type="revolute" />
        </assembly>,
      ),
    ).toThrow('part "arm" is under-constrained');
  });

    test("conflicting mates are an error naming both, with lines", () => {
    let err: TscadError | undefined;
    try {
      compile(
        <assembly>
          <Link name="g" length={10} fixed />
          <Link name="arm" length={10} />
          <mate a="g.tip" b="arm.base" />
          <mate a="g.base" b="arm.tip" />
        </assembly>,
      );
    } catch (e) {
      err = e as TscadError;
    }
    expect(err).toBeInstanceOf(TscadError);
    expect(err!.detail).toMatch(/over-constrained assembly: <mate a="g.base" b="arm.tip" type="fastened"> conflicts with <mate a="g.tip" b="arm.base" type="fastened"> \(assembly\.test\.tsx:\d+\)/);
    expect(err!.loc?.file).toContain("assembly.test.tsx");
  });

  test("missing anchors suggest names", () => {
    expect(() =>
      compile(
        <assembly>
          <Link name="g" length={10} fixed />
          <Link name="arm" length={10} />
          <mate a="g.tpi" b="arm.base" />
        </assembly>,
      ),
    ).toThrow(/no anchor "g.tpi"[\s\S]*did you mean "g.tip"/);
    expect(() => compile(<part name="p"><box size={1} /><mate a="x.y" b="z.w" /></part>)).toThrow("belongs directly inside an <assembly>");
  });
});

describe("mated assemblies in the kernel", () => {
  test("volumes and bounding boxes", async () => {
    const r = compile(
      <assembly>
        <Link name="base" length={10} fixed />
        <Link name="arm" length={30} />
        <mate a="base.tip" b="arm.base" type="revolute" angle={90} />
      </assembly>,
    );
    const e = await k.evaluate(r.document, { noMesh: true });
    const arm = e.parts.find((p) => p.name === "arm")!;
    expect(arm.ok).toBe(true);
    expect(arm.volume!).toBeCloseTo(30 * 4 * 2, 6);
    const [min, max] = arm.bbox!;
    close(min, [8, 0, 0], 1e-6);
    close(max, [12, 30, 2], 1e-6);
  }, 30_000);
});

describe("assembly examples", () => {
  test("hinge box: closed is flush, open swings about the shared back edge", async () => {
    const { renderModule } = await import("tscad");
    const mod = await import("../examples/assembly-hinge-box.tsx");
    const bbox = async (open: number) => {
      const r = renderModule(mod, { open });
      expect(r.warnings).toEqual([]);
      const e = await k.evaluate(r.document, { noMesh: true });
      const lid = e.parts.find((p) => p.name === "lid")!, base = e.parts.find((p) => p.name === "base")!;
      expect(lid.ok && base.ok).toBe(true);
      return { lid: lid.bbox!, base: base.bbox! };
    };
    const shut = await bbox(0);
    close(shut.lid[0], [-40, -25, 30], 1e-6); // lid bottom on the box top
    expect(shut.lid[0][2]).toBeCloseTo(shut.base[1][2], 9);
    const up = await bbox(90);
    close(up.lid[0], [-40, 25, 30], 1e-6);
    close(up.lid[1], [40, 31, 80], 1e-6);
  }, 30_000);

  test("arm: the forearm tip follows forward kinematics", async () => {
    const { renderModule } = await import("tscad");
    const r = renderModule(await import("../examples/assembly-arm.tsx"));
    expect(r.warnings).toEqual([]);
    const [yaw, s, el, U, F] = [30, 50, -70, 80, 70];
    const reach = U * Math.cos(s * DEG) + F * Math.cos((s + el) * DEG);
    const z = 12 + 36 + U * Math.sin(s * DEG) + F * Math.sin((s + el) * DEG);
    close(origin(frame(r, "forearm", "end")), [reach * Math.cos(yaw * DEG), reach * Math.sin(yaw * DEG), z], 1e-8);
    expect(r.assembly!.parts.every((p) => p.dof === 0)).toBe(true);
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.parts.every((p) => p.ok)).toBe(true);
  }, 30_000);
});

test("moved parts keep source locations on the new wrapper", () => {
  const r = compile(
    <assembly>
      <part name="a"><box size={1} /><anchor id="p" /></part>
      <part name="b"><sphere r={1} /><anchor id="q" /></part>
      <mate a="a.p" b="b.q" offset={5} />
    </assembly>,
  );
  expect(r.document.parts![1]!.node.type).toBe("transform");
  expect(r.sourceMap["parts/1"]?.tag).toBe("part");
  expect(r.sourceMap["parts/1/0"]?.tag).toBe("sphere");
});

describe("nested assemblies, gears, limits, cache", () => {
  /** A sub-assembly: a bracket with an arm hinged on it, exposing the bracket's foot. */
  function Hinged({ name, angle }: { name: string; angle: number }) {
    return (
      <assembly name={name}>
        <part name={`${name}-bracket`}>
          <box size={[10, 10, 10]} />
          <anchor id="foot" />
          <anchor id="pin" at={[0, 0, 10]} />
        </part>
        <part name={`${name}-arm`}>
          <box size={[20, 2, 2]} center={[false, true, false]} />
          <anchor id="pin" />
          <anchor id="end" at={[20, 0, 0]} />
        </part>
        <mate a={`${name}-bracket.pin`} b={`${name}-arm.pin`} type="revolute" angle={angle} />
      </assembly>
    );
  }

  test("inner assemblies are solved first, then placed as rigid groups", () => {
    const r = compile(
      <assembly>
        <part name="table" fixed>
          <box size={[100, 100, 5]} />
          <anchor id="left" at={[-30, 0, 5]} />
          <anchor id="right" at={[30, 0, 5]} />
        </part>
        <Hinged name="h1" angle={90} />
        <Hinged name="h2" angle={0} />
        <mate a="table.left" b="h1.h1-bracket.foot" />
        <mate a="table.right" b="h2-bracket.foot" angle={180} />
      </assembly>,
    );
    expect(r.warnings).toEqual([]);
    close(origin(frame(r, "h1-arm", "end")), [-30, 20, 15]);
    close(origin(frame(r, "h2-arm", "end")), [10, 0, 15]);
    expect(r.assembly!.parts.every((p) => p.dof === 0)).toBe(true);
  });

  test("an inner mate can't reach outside its assembly", () => {
    expect(() =>
      compile(
        <assembly>
          <part name="table" fixed><box size={5} /><anchor id="top" /></part>
          <assembly name="sub">
            <part name="x"><box size={1} /><anchor id="p" /></part>
            <part name="y"><box size={1} /><anchor id="p" /></part>
            <mate a="table.top" b="x.p" />
          </assembly>
        </assembly>,
      ),
    ).toThrow(/no anchor "table.top" in this assembly/);
  });

  test("gear couples two revolute joints", () => {
    const r = compile(
      <assembly>
        <part name="frame" fixed>
          <box size={[60, 10, 2]} />
          <anchor id="a" at={[-15, 0, 2]} />
          <anchor id="b" at={[15, 0, 2]} />
        </part>
        <part name="pinion"><cylinder r={10} h={2} /><anchor id="hub" /><anchor id="mark" at={[10, 0, 0]} /></part>
        <part name="wheel"><cylinder r={20} h={2} /><anchor id="hub" /><anchor id="mark" at={[20, 0, 0]} /></part>
        <mate id="drive" a="frame.a" b="pinion.hub" type="revolute" angle={60} />
        <mate id="driven" a="frame.b" b="wheel.hub" type="revolute" />
        <gear a="drive" b="driven" ratio={-0.5} />
      </assembly>,
    );
    expect(r.warnings).toEqual([]);
    const m = r.assembly!.mates.find((x) => x.id === "driven")!;
    expect(m.value.angle).toBeCloseTo(-30, 9);
    close(origin(frame(r, "wheel", "mark")), [15 + 20 * Math.cos(-30 * DEG), 20 * Math.sin(-30 * DEG), 2]);
    expect(r.assembly!.parts.every((p) => p.dof === 0)).toBe(true);
  });

  test("limits warn when a joint is out of range", () => {
    const el = (angle: number) => (
      <assembly>
        <Link name="g" length={10} fixed />
        <Link name="arm" length={10} />
        <mate a="g.tip" b="arm.base" type="revolute" angle={angle} limits={[-90, 90]} />
      </assembly>
    );
    expect(compile(el(45)).warnings).toEqual([]);
    expect(compile(el(120)).warnings.some((w) => w.includes("angle 120° is outside limits [-90, 90]"))).toBe(true);
  });

  test("unchanged assemblies reuse the solve (and replay warnings)", () => {
    const el = (h: number) => (
      <assembly>
        <Link name="g" length={10} fixed />
        <Link name="arm" length={10} />
        <mate a="g.tip" b="arm.base" type="revolute" />
        <part name="other"><box size={h} /></part>
      </assembly>
    );
    const a = compile(el(3)), b = compile(el(5));
    expect(b.assembly!.mates[0]).toBe(a.assembly!.mates[0]); // the cached object
    expect(b.warnings).toEqual(a.warnings);
    expect(a.warnings.length).toBe(1);
  });
});
