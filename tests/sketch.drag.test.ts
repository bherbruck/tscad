/**
 * Drag-to-edit: dragSolve (weighted re-solve, blockers, released dimensions) and the source
 * edits it proposes (literal replaced / inserted, expression refused with its driving param).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { renderModule } from "../src/index";
import { applyChange, applyChanges, dragSolve, editProp, insertChild } from "../src/core/sketch/drag";

const DIR = new URL("./.drag-tmp/", import.meta.url);
const SOURCE = `import { defineParams, type ParamValues } from "tscad"

export const params = defineParams({
  width: { type: "number", default: 40, min: 10, max: 100 },
})

export default function Model(p: ParamValues<typeof params>) {
  return (
    <extrude height={2}>
      <sketch>
        <point id="o" fixed />
        <line id="base" from="o" to="a" horizontal length={p.width} />
        <line id="side" from="a" to="b" vertical length={20} />
        <line from="b" to="c" horizontal />
        <line from="c" to="o" vertical />
        <circle id="hole" center="h" r={3} />
        <point id="h" x={10} y={10} />
        <point id="g" x={5} y={5} />
        <onCurve point="g" curve="base" />
        <line from="h" to="k" construction />
      </sketch>
    </extrude>
  )
}
`;
let mod: any, values: any, sketchLoc: any;
beforeAll(async () => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(new URL("model.tsx", DIR), SOURCE);
  mod = await import(new URL("model.tsx", DIR).href);
  const r = renderModule(mod);
  values = r.values;
  sketchLoc = r.sketches[0]!.loc;
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const point = (r: { points: { id: string; x: number; y: number; moved: boolean }[] }, id: string) => r.points.find((p) => p.id === id)!;

describe("dragSolve", () => {
  test("a free point goes where it's dragged; its <point> literals are the edit", () => {
    const r = dragSolve(mod, values, { sketch: sketchLoc, point: "h", target: [25, 12] });
    expect(r.reached).toBe(true);
    expect([point(r, "h").x, point(r, "h").y]).toEqual([25, 12]);
    expect(point(r, "a").moved).toBe(false); // constrained geometry holds
    const xs = r.changes.filter((c) => c.kind === "prop" && c.reason === "point");
    expect(xs.map((c) => c.kind === "prop" && [c.prop, c.value])).toEqual([["x", 25], ["y", 12]]);
    const out = applyChanges(SOURCE, r.changes.filter((c) => c.kind === "prop"));
    expect(out.refused).toEqual([]);
    expect(out.source).toContain(`<point id="h" x={25} y={12} />`);
  });

  test("a point on a line only slides along it; the line constraint is reported as blocking", () => {
    const r = dragSolve(mod, values, { sketch: sketchLoc, point: "g", target: [15, 5] });
    expect(r.reached).toBe(false);
    expect(point(r, "g").x).toBeCloseTo(15, 6);
    expect(point(r, "g").y).toBeCloseTo(0, 9);
    expect(r.blockedBy.map((b) => b.label)).toContain('<onCurve point="g" curve="base">');
    expect(r.blockedBy[0]!.loc?.line).toBe(19);
  });

  test("dragging a dimensioned corner with changeDimensions: the literal changes", () => {
    const r = dragSolve(mod, values, { sketch: sketchLoc, point: "b", target: [40, 30], changeDimensions: true });
    expect(r.reached).toBe(true);
    const dim = r.changes.find((c) => c.kind === "prop" && c.reason === "dimension")!;
    expect(dim).toMatchObject({ kind: "prop", tag: "line", prop: "length", value: 30 });
    const out = applyChange(SOURCE, dim);
    expect(out.ok && out.source).toContain(`<line id="side" from="a" to="b" vertical length={30} />`);
  });

  test("without changeDimensions the corner holds and says what holds it", () => {
    const r = dragSolve(mod, values, { sketch: sketchLoc, point: "b", target: [40, 30] });
    expect(r.reached).toBe(false);
    expect(point(r, "b").y).toBeCloseTo(20, 9);
    expect(r.blockedBy.some((b) => b.label === 'length=20 on line "side"' && b.loc?.line === 13 && b.dimension?.value === 20)).toBe(true);
  });

  test("a param-driven dimension: the edit is refused and the param value computed", () => {
    const r = dragSolve(mod, values, { sketch: sketchLoc, point: "a", target: [55, 0], changeDimensions: true });
    expect(r.reached).toBe(true);
    const dim = r.changes.find((c) => c.kind === "prop" && c.prop === "length")!;
    expect(dim).toMatchObject({ value: 55, param: { name: "width", value: 55 } });
    const out = applyChange(SOURCE, dim);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe("length is set by an expression, not a number: driven by param width");
    expect(out.param).toEqual({ name: "width", value: 55 });
  });

  test("a free implicit point (no <point> element): add one", () => {
    const r = dragSolve(mod, values, { sketch: sketchLoc, point: "k", target: [30, 15] });
    expect(r.reached).toBe(true);
    const add = r.changes.find((c) => c.kind === "addPoint")!;
    expect(add).toMatchObject({ kind: "addPoint", id: "k", x: 30, y: 15 });
    const out = applyChange(SOURCE, add);
    expect(out.ok && out.source).toContain(`      <sketch>\n        <point id="k" x={30} y={15} />\n        <point id="o" fixed />`);
  });
});

describe("source edits", () => {
  const loc = (line: number, column: number, tag: string) => ({ file: "x.tsx", line, column, tag });
  test("replace a literal, insert a missing prop, refuse an expression", () => {
    const src = `a\n  <line id="s" length={20} />\n  <box size={p.w * 2} />\n  <point id="o" />\n`;
    const r1 = editProp(src, loc(2, 3, "line"), "length", 12.34567);
    expect(r1.ok && r1.source).toContain(`length={12.3457}`);
    const r2 = editProp(src, loc(4, 3, "point"), "x", -3);
    expect(r2.ok && r2.source).toContain(`<point id="o" x={-3} />`);
    const r3 = editProp(src, loc(3, 3, "box"), "size", 5);
    expect(r3).toEqual({ ok: false, reason: "size is set by an expression, not a number", expression: "p.w * 2" });
    const r4 = insertChild(`<sketch>\n</sketch>`, loc(1, 1, "sketch"), `<point id="q" />`);
    expect(r4.ok && r4.source).toBe(`<sketch>\n  <point id="q" />\n</sketch>`);
  });
});

test("dragging a corner straight along its line: the dimension that resists ranks first", () => {
  const r = dragSolve(mod, values, { sketch: sketchLoc, point: "b", target: [40, 30] });
  expect(r.blockedBy[0]!.label).toBe('length=20 on line "side"');
});
