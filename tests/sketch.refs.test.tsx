/**
 * Typed sketch references: `sketchRefs()` handles in place of string ids.
 */
import { describe, expect, test } from "bun:test";
import { compile, sketchRef, sketchRefs, TscadError, type Children } from "tscad";

const sketches = (el: Children) => compile(<extrude height={1}>{el}</extrude>);

describe("sketch refs", () => {
  test("handles work like ids, including derived points", () => {
    const s = sketchRefs<{ o: "point"; a: "point"; b: "point"; c: "point"; base: "line"; right: "line"; top: "arc" }>();
    const r = sketches(
      <sketch>
        <point ref={s.o} fixed />
        <line ref={s.base} from={s.o} to={s.a} horizontal length={20} />
        <line ref={s.right} from={s.base.end} to={s.b} vertical length={30} />
        <arc ref={s.top} from={s.b} to={s.c} tangent={s.right} radius={10} />
        <line from={s.c} to={s.o} tangent={s.top} />
      </sketch>,
    );
    expect(r.warnings).toEqual([]);
    const info = r.sketches[0]!;
    expect(info.dof).toBe(0);
    expect(info.points.map((p) => p.id)).toEqual(["o", "a", "b", "c", "top.center"]);
    expect(info.entities.find((e) => e.id === "top")).toMatchObject({ kind: "arc", center: [10, 30], radius: 10 });
  });

  test("mixed with string ids, and a single sketchRef", () => {
    const hole = sketchRef<"circle">("hole");
    const r = sketches(
      <sketch>
        <point id="o" fixed />
        <line from="o" to="a" horizontal length={10} />
        <line from="a" to="b" vertical length={10} />
        <line from="b" to="c" horizontal />
        <line from="c" to="o" vertical />
        <circle ref={hole} center={[5, 5]} r={2} />
        <concentric a={hole} b={hole} />
        <dimension a="o" b={hole} dx={5} />
        <dimension a="o" b={hole.center} dy={5} />
      </sketch>,
    );
    expect(r.sketches[0]!.dof).toBe(0);
  });

  test("a handle used as a curve but never attached is an error at the use", () => {
    const s = sketchRefs("o", "a", "base", "arc");
    let err: TscadError | undefined;
    try {
      sketches(
        <sketch>
          <point ref={s.o} fixed />
          <line ref={s.base} from={s.o} to={s.a} horizontal length={10} />
          <line from={s.a} to={s.o} tangent={s.arc} />
        </sketch>,
      );
    } catch (e) {
      err = e as TscadError;
    }
    expect(err?.detail).toBe("tangent: handle .arc is used but never attached in this sketch");
    expect(err?.loc?.line).toBeGreaterThan(0);
    expect(err?.hint).toContain("<line ref={….arc} …/>");
  });

  test("a declared point nothing uses warns at its declaration", () => {
    const s = sketchRefs("o", "h");
    const r = sketches(
      <sketch allowFree>
        <point ref={s.o} fixed />
        <point ref={s.h} x={3} y={3} />
        <circle center={s.o} r={4} />
      </sketch>,
    );
    expect(r.warnings.some((w) => /sketch\.refs\.test\.tsx:\d+:\d+: <point> point "h" is declared but nothing uses it/.test(w))).toBe(true);
  });

  test("conflict messages name handles readably", () => {
    const s = sketchRefs("o", "a", "base");
    expect(() =>
      sketches(
        <sketch>
          <point ref={s.o} fixed />
          <line ref={s.base} from={s.o} to={s.a} horizontal length={40} />
          <dimension a={s.o} b={s.a} distance={50} />
        </sketch>,
      ),
    ).toThrow('over-constrained: <dimension a={o} b={a} distance=50> conflicts with length=40 on line "base"');
  });

  test("ref and id together, or attaching a handle twice, are errors", () => {
    const s = sketchRefs("o");
    expect(() => (s as any).typo).toThrow('no handle named "typo"');
    expect(() => sketches(<sketch><point ref={s.o} id="o" /></sketch>)).toThrow("either id or ref");
    expect(() => sketches(<sketch><point ref={s.o} fixed /><point ref={s.o} /></sketch>)).toThrow('duplicate id "o"');
  });

  test("kinds are checked by TypeScript", () => {
    const s = sketchRefs<{ p: "point"; l: "line"; c: "circle" }>();
    const ok = <line from={s.p} to={[1, 1]} tangent={s.c} />;
    // @ts-expect-error a point is not an arc/circle
    const bad1 = <line from={s.p} to={[1, 1]} tangent={s.p} />;
    // @ts-expect-error a line is not a point
    const bad2 = <line from={s.l} to={[1, 1]} />;
    // @ts-expect-error parallel takes lines
    const bad3 = <parallel a={s.c} b={s.l} />;
    expect([ok, bad1, bad2, bad3].length).toBe(4);
  });
});

describe("solve cache and side", () => {
  const model = (w: number, extra: number) => {
    const s = sketchRefs("o", "base");
    return (
      <part name="p">
        <extrude height={1}>
          <sketch>
            <point ref={s.o} fixed />
            <line ref={s.base} from={s.o} to="a" horizontal length={w} />
            <line from="a" to="b" vertical length={10} />
            <line from="b" to={s.o} />
          </sketch>
        </extrude>
        <box size={extra} />
      </part>
    );
  };
  test("an unchanged sketch (fresh handles each render) reuses the solve", () => {
    const a = compile(model(20, 3)).sketches[0]!;
    const b = compile(model(20, 7)).sketches[0]!;
    const c = compile(model(25, 3)).sketches[0]!;
    expect(b.entities).toBe(a.entities); // same cached solve
    expect(c.entities).not.toBe(a.entities);
    expect(c.points.find((p) => p.id === "a")!.x).toBe(25);
  });
  test("cached solves replay their warnings", () => {
    const el = () => <extrude height={1}><sketch><circle center={[0, 0]} r={3} /></sketch></extrude>;
    const w1 = compile(el()).warnings, w2 = compile(el()).warnings;
    expect(w1.length).toBe(1);
    expect(w2).toEqual(w1);
  });
  test("side picks the side of a line regardless of the drawing", () => {
    const at = (side: "left" | "right") =>
      compile(
        <extrude height={1}>
          <sketch allowFree>
            <point id="o" fixed />
            <line id="base" from="o" to="a" horizontal length={20} construction />
            <circle id="c" center={[10, 5]} r={2} />
            <dimension a="c" b="base" distance={8} side={side} />
          </sketch>
        </extrude>,
      ).sketches[0]!.entities.find((e) => e.id === "c") as { center: [number, number] };
    expect(at("left").center[1]).toBeCloseTo(8, 9);
    expect(at("right").center[1]).toBeCloseTo(-8, 9);
  });
});
