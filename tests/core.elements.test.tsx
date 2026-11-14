import { describe, expect, test } from "bun:test";
import { compile, edges, faces, materials, TscadError, type Children, type Node } from "tscad";

/** The single part's root node. */
const ir = (el: Children): Node => compile(el).document.parts![0]!.node;
const T = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

describe("primitives", () => {
  test("box: centred XY, base on z=0 by default", () => {
    expect(ir(<box size={[10, 20, 30]} />)).toEqual({ type: "transform", matrix: T(-5, -10, 0) as any, children: [{ type: "box", size: [10, 20, 30] }] });
    expect(ir(<box w={1} d={2} h={3} center />)).toEqual({ type: "box", size: [1, 2, 3], center: true });
    expect(ir(<box width={1} depth={2} height={3} center={false} />)).toEqual({ type: "box", size: [1, 2, 3] });
    expect(ir(<box size={4} center={[false, true, true]} />)).toEqual({ type: "transform", matrix: T(0, -2, -2) as any, children: [{ type: "box", size: [4, 4, 4] }] });
  });
  test("cylinder / cone / sphere / torus aliases", () => {
    expect(ir(<cylinder r={2} h={5} />)).toEqual({ type: "cylinder", radius: 2, height: 5 });
    expect(ir(<cylinder diameter={4} height={5} center />)).toEqual({ type: "cylinder", radius: 2, height: 5, center: true });
    expect(ir(<cone d1={10} d2={0} h={3} />)).toEqual({ type: "cone", bottomRadius: 5, topRadius: 0, height: 3 });
    expect(ir(<sphere d={6} />)).toEqual({ type: "sphere", radius: 3 });
    expect(ir(<torus major={10} minor={2} />)).toEqual({ type: "torus", majorRadius: 10, minorRadius: 2 });
  });
  test("validation errors carry the source location", () => {
    try {
      compile(<cylinder r={-1} h={5} />);
      throw new Error("no throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TscadError);
      const err = e as TscadError;
      expect(err.loc?.file).toEndWith("core.elements.test.tsx");
      expect(err.loc?.tag).toBe("cylinder");
      expect(err.message).toMatch(/r must be greater than 0 \(got -1\)/);
    }
    const badSize: any = [1, 2];
    expect(() => compile(<box size={badSize} />)).toThrow(/size must be \[x, y, z\]/);
    expect(() => compile(<box />)).toThrow(/needs a size/);
    expect(() => compile(<torus R={2} r={3} />)).toThrow(/smaller than the major/);
    expect(() => compile(<cone r1={0} r2={0} h={1} />)).toThrow(/both be 0/);
    // @ts-expect-error unknown element (typo)
    expect(() => compile(<sphre r={1} />)).toThrow(/did you mean <sphere>/);
  });
});

describe("step import", () => {
  test("<step> emits a step node, placed", () => {
    const data = "ISO-10303-21;\nHEADER;ENDSEC;DATA;ENDSEC;END-ISO-10303-21;";
    expect(ir(<step data={data} />)).toEqual({ type: "step", data } as Node);
    expect(ir(<step data={data} solid={1} z={5} />)).toEqual({ type: "transform", matrix: T(0, 0, 5) as any, children: [{ type: "step", data, solid: 1 } as Node] });
    expect(() => compile(<step data="" />)).toThrow(/needs data/);
    expect(compile(<step data="hello" />).warnings[0]).toMatch(/STEP file/);
  });
});

describe("placement props", () => {
  test("translate only", () => {
    expect(ir(<sphere r={1} x={1} y={2} z={3} />)).toEqual({ type: "transform", matrix: T(1, 2, 3) as any, children: [{ type: "sphere", radius: 1 }] });
    expect(ir(<sphere r={1} at={[1, 2, 3]} x={1} />)).toMatchObject({ matrix: T(2, 2, 3) });
  });
  test("identity placement emits no transform", () => {
    expect(ir(<sphere r={1} x={0} rotate={[0, 0, 0]} scale={1} />)).toEqual({ type: "sphere", radius: 1 });
  });
  test("rotate is exact for right angles; order mirror → scale → rotate → translate", () => {
    const m = (ir(<sphere r={1} rotateZ={90} x={10} />) as any).matrix;
    expect(m).toEqual([0, -1, 0, 10, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const m2 = (ir(<sphere r={1} mirror="x" scale={2} rotate={[0, 0, 90]} z={1} />) as any).matrix;
    // p=(1,0,0): mirror → (-1,0,0), scale → (-2,0,0), rotZ90 → (0,-2,0), +z → (0,-2,1)
    const p = [m2[0] + m2[3], m2[4] + m2[7], m2[8] + m2[11]];
    expect(p).toEqual([0, -2, 1]);
    // rotate X then Y (fixed axes): (0,1,0) -X90→ (0,0,1) -Y90→ (1,0,0)
    const r = (ir(<sphere r={1} rotate={[90, 90, 0]} />) as any).matrix;
    expect([r[1], r[5], r[9]]).toEqual([1, 0, 0]);
  });
  test("primitive offset and placement merge into one transform", () => {
    expect(ir(<box size={[2, 2, 2]} z={5} />)).toEqual({ type: "transform", matrix: T(-1, -1, 5) as any, children: [{ type: "box", size: [2, 2, 2] }] });
  });
  test("groups place their children directly (no extra union)", () => {
    expect(ir(<group x={5}><sphere r={1} /><sphere r={2} /></group>)).toEqual({
      type: "transform",
      matrix: T(5, 0, 0) as any,
      children: [{ type: "sphere", radius: 1 }, { type: "sphere", radius: 2 }],
    });
  });
});

describe("transforms", () => {
  test("translate / rotate / scale / mirror", () => {
    expect(ir(<translate by={[1, 2, 3]}><sphere r={1} /></translate>)).toMatchObject({ type: "transform", matrix: T(1, 2, 3) });
    expect((ir(<rotate z={180}><sphere r={1} /></rotate>) as any).matrix).toEqual([-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect((ir(<rotate axis="x" angle={90}><sphere r={1} /></rotate>) as any).matrix.slice(4, 8)).toEqual([0, 0, -1, 0]);
    expect((ir(<rotate z={90} origin={[1, 0, 0]}><sphere r={1} /></rotate>) as any).matrix).toEqual([0, -1, 0, 1, 1, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect((ir(<scale by={[1, 2, 3]}><sphere r={1} /></scale>) as any).matrix).toEqual([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1]);
    expect((ir(<mirror axis="y"><sphere r={1} /></mirror>) as any).matrix).toEqual([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
  test("mirror keep = original + mirrored copy", () => {
    const n = ir(<mirror axis="x" keep><sphere r={1} x={5} /></mirror>) as any;
    expect(n.type).toBe("union");
    expect(n.children[0]).toMatchObject({ matrix: T(5, 0, 0) });
    expect(n.children[1].matrix[0]).toBe(-1);
    expect(n.children[1].children[0]).toBe(n.children[0]);
  });
});

describe("booleans", () => {
  test("difference / subtract / intersection / intersect / union", () => {
    const a = <sphere r={2} />, b = <sphere r={1} />;
    expect(ir(<difference>{a}{b}</difference>)).toEqual({ type: "difference", children: [{ type: "sphere", radius: 2 }, { type: "sphere", radius: 1 }] });
    expect(ir(<subtract>{a}{b}</subtract>).type).toBe("difference");
    expect(ir(<intersect>{a}{b}</intersect>).type).toBe("intersection");
    expect(ir(<intersection>{a}{b}</intersection>).type).toBe("intersection");
    expect(ir(<union>{a}{b}</union>).type).toBe("union");
  });
  test("empty difference errors; single child warns", () => {
    expect(() => compile(<difference />)).toThrow(/empty/);
    const r = compile(<difference><sphere r={1} /></difference>);
    expect(r.warnings[0]).toMatch(/nothing is subtracted/);
    expect(r.document.parts![0]!.node).toEqual({ type: "sphere", radius: 1 });
  });
});

describe("patterns", () => {
  test("linear", () => {
    const n = ir(<linearPattern count={3} dx={10}><sphere r={1} /></linearPattern>) as any;
    expect(n.type).toBe("union");
    expect(n.children.length).toBe(3);
    expect(n.children[0]).toEqual({ type: "sphere", radius: 1 });
    expect(n.children[2].matrix[3]).toBe(20);
    const c = ir(<linearPattern count={3} step={[0, 5, 0]} center><sphere r={1} /></linearPattern>) as any;
    expect(c.children.map((k: any) => k.matrix?.[7] ?? 0)).toEqual([-5, 0, 5]);
  });
  test("grid (centred by default)", () => {
    const n = ir(<gridPattern nx={2} ny={2} dx={10} dy={20}><sphere r={1} /></gridPattern>) as any;
    expect(n.children.map((k: any) => [k.matrix[3], k.matrix[7]])).toEqual([[-5, -10], [5, -10], [-5, 10], [5, 10]]);
  });
  test("polar with radius; partial angle spans first..last", () => {
    const n = ir(<polarPattern count={4} radius={10}><sphere r={1} /></polarPattern>) as any;
    expect(n.children.map((k: any) => [k.matrix[3], k.matrix[7]])).toEqual([[10, 0], [0, 10], [-10, 0], [0, -10]]);
    const p = ir(<polarPattern count={3} angle={90} radius={1}><sphere r={1} /></polarPattern>) as any;
    const xy = p.children.map((k: any) => [k.matrix?.[3] ?? 1, k.matrix?.[7] ?? 0]);
    [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1]].forEach(([x, y], i) => {
      expect(xy[i][0]).toBeCloseTo(x!, 12);
      expect(xy[i][1]).toBeCloseTo(y!, 12);
    });
  });
});

describe("features", () => {
  test("fillet / chamfer / shell", () => {
    expect(ir(<fillet radius={1} edges={edges.top()}><sphere r={3} /></fillet>)).toEqual({ type: "fillet", radius: 1, edges: { type: "max", axis: "z" }, children: [{ type: "sphere", radius: 3 }] });
    expect(ir(<fillet r={1}><sphere r={3} /></fillet>)).toEqual({ type: "fillet", radius: 1, children: [{ type: "sphere", radius: 3 }] });
    expect(ir(<chamfer distance={0.5} edges="|Z or >Z"><sphere r={3} /></chamfer>)).toMatchObject({ type: "chamfer", distance: 0.5, edges: { type: "or" } });
    expect(ir(<shell thickness={2} open={faces.top()}><sphere r={3} /></shell>)).toEqual({ type: "shell", thickness: -2, faces: { type: "max", axis: "z" }, children: [{ type: "sphere", radius: 3 }] });
    expect(ir(<shell thickness={2} outward><sphere r={3} /></shell>)).toMatchObject({ thickness: 2 });
  });
  test("radius 0 skips the feature (params-friendly)", () => {
    expect(ir(<fillet radius={0}><sphere r={3} /></fillet>)).toEqual({ type: "sphere", radius: 3 });
  });
  test("bad selector string is a located error", () => {
    expect(() => compile(<fillet radius={1} edges=">W"><sphere r={3} /></fillet>)).toThrow(/core.elements.test.tsx:\d+:\d+: <fillet> edges: unexpected/);
  });
});

describe("parts & assemblies", () => {
  test("loose solids become one part named 'part'", () => {
    const r = compile(<><sphere r={1} /><sphere r={2} /></>);
    expect(r.document.parts!.length).toBe(1);
    expect(r.document.parts![0]!.name).toBe("part");
    expect(r.document.parts![0]!.node.type).toBe("union");
  });
  test("assembly placement composes into parts; materials give colour + density", () => {
    const r = compile(
      <assembly name="kit" z={10}>
        <part name="a" material="aluminum">
          <sphere r={1} />
        </part>
        <part name="b" color="red" x={5}>
          <sphere r={1} />
        </part>
        <part name="a" visible={false}>
          <sphere r={1} />
        </part>
      </assembly>,
    );
    const [a, b] = r.document.parts!;
    expect(r.document.parts!.length).toBe(2);
    expect(a).toEqual({ name: "a", color: materials.aluminum.color, node: { type: "transform", matrix: T(0, 0, 10) as any, children: [{ type: "sphere", radius: 1 }] } });
    expect(b!.color).toBe("red");
    expect((b!.node as any).matrix).toEqual(T(5, 0, 10));
    expect(r.parts.map((p) => [p.name, p.visible, p.index, p.density])).toEqual([["a", true, 0, 2.7], ["b", true, 1, undefined], ["a-2", false, -1, undefined]]);
    expect(r.warnings.some((w) => w.includes("duplicate part name"))).toBe(true);
  });
  test("parts can't nest in solids", () => {
    expect(() => compile(<union><part><sphere r={1} /></part></union>)).toThrow(/can't be nested/);
  });
});

describe("source map", () => {
  test("every node path maps to the JSX that made it (kernel numbering)", () => {
    function Peg({ x }: { x: number }) {
      return <cylinder r={1} h={4} x={x} />;
    }
    const line = Number(new Error().stack!.split("\n")[1]!.match(/:(\d+):\d+/)![1]);
    const r = compile(
      <part name="p">
        <difference>
          <box size={[20, 10, 2]} />
          <Peg x={3} />
        </difference>
      </part>,
    );
    const sm = r.sourceMap;
    expect(Object.keys(sm).sort()).toEqual(["parts/0", "parts/0/0", "parts/0/0/0", "parts/0/1", "parts/0/1/0"]);
    expect(sm["parts/0"]!.tag).toBe("difference");
    expect(sm["parts/0"]!.line).toBe(line + 3);
    expect(sm["parts/0/0/0"]!.tag).toBe("box");
    expect(sm["parts/0/0/0"]!.line).toBe(line + 4);
    // the component's tail-call frame is gone (JSC), so the <Peg> usage site is used
    expect(sm["parts/0/1"]!.tag).toBe("cylinder");
    expect(sm["parts/0/1"]!.line).toBe(line + 5);
    expect(sm["parts/0/1"]!.component).toBe("Peg");
  });
});
