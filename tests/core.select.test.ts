import { describe, expect, test } from "bun:test";
import { edges, faces, parseSelector, SelectorSyntaxError, toSelector } from "tscad";

describe("selector strings", () => {
  test("atoms", () => {
    expect(parseSelector(">Z")).toEqual({ type: "max", axis: "z" });
    expect(parseSelector("<x")).toEqual({ type: "min", axis: "x" });
    expect(parseSelector("|Y")).toEqual({ type: "parallel", axis: "y" });
    expect(parseSelector("#Z")).toEqual({ type: "perpendicular", axis: "z" });
    expect(parseSelector("*")).toEqual({ type: "all" });
  });
  test("and / or / not with precedence and parentheses", () => {
    expect(parseSelector(">Z or |Z")).toEqual({ type: "or", of: [{ type: "max", axis: "z" }, { type: "parallel", axis: "z" }] });
    expect(parseSelector(">Z and |X or <Z")).toEqual({
      type: "or",
      of: [{ type: "and", of: [{ type: "max", axis: "z" }, { type: "parallel", axis: "x" }] }, { type: "min", axis: "z" }],
    });
    expect(parseSelector("not (>Z or <Z)")).toEqual({ type: "not", of: { type: "or", of: [{ type: "max", axis: "z" }, { type: "min", axis: "z" }] } });
    expect(parseSelector("NOT <Z AND |Z")).toEqual({ type: "and", of: [{ type: "not", of: { type: "min", axis: "z" } }, { type: "parallel", axis: "z" }] });
  });
  test("syntax errors", () => {
    expect(() => parseSelector("")).toThrow(SelectorSyntaxError);
    expect(() => parseSelector(">Q")).toThrow(/unexpected/);
    expect(() => parseSelector("(>Z")).toThrow(/missing \)/);
    expect(() => parseSelector(">Z |Z")).toThrow(/unexpected/);
  });
});

describe("selector builder", () => {
  test("named filters", () => {
    expect(edges.top().toIR()).toEqual({ type: "max", axis: "z" });
    expect(edges.bottom().toIR()).toEqual({ type: "min", axis: "z" });
    expect(edges.vertical().toIR()).toEqual({ type: "parallel", axis: "z" });
    expect(edges.circles().toIR()).toEqual({ type: "perpendicular", axis: "z" });
    expect(edges.radius(3).toIR()).toEqual({ type: "radius", radius: 3 });
    expect(edges.within([0, 0, 0], [1, 1, 1]).toIR()).toEqual({ type: "within", min: [0, 0, 0], max: [1, 1, 1] });
    expect(edges.index(1, [2, 3]).toIR()).toEqual({ type: "index", indices: [1, 2, 3] });
    expect(edges.toIR()).toEqual({ type: "all" });
    expect(faces.none().toIR()).toEqual({ type: "none" });
  });
  test("chaining ANDs; and/or/not combine", () => {
    expect(edges.top().circles().toIR()).toEqual({ type: "and", of: [{ type: "max", axis: "z" }, { type: "perpendicular", axis: "z" }] });
    expect(edges.top().or(edges.vertical()).toIR()).toEqual({ type: "or", of: [{ type: "max", axis: "z" }, { type: "parallel", axis: "z" }] });
    expect(edges.top().or("|Z").or(">X").toIR()).toEqual({
      type: "or",
      of: [{ type: "max", axis: "z" }, { type: "parallel", axis: "z" }, { type: "max", axis: "x" }],
    });
    expect(edges.top().not().toIR()).toEqual({ type: "not", of: { type: "max", axis: "z" } });
    expect(edges.circles().and("<Z").toIR()).toEqual({ type: "and", of: [{ type: "perpendicular", axis: "z" }, { type: "min", axis: "z" }] });
  });
  test("toSelector accepts strings, builders and raw IR", () => {
    expect(toSelector(">Z")).toEqual({ type: "max", axis: "z" });
    expect(toSelector(faces.top())).toEqual({ type: "max", axis: "z" });
    expect(toSelector({ type: "radius", radius: 2 })).toEqual({ type: "radius", radius: 2 });
    expect(JSON.parse(JSON.stringify({ e: edges.top() }))).toEqual({ e: { type: "max", axis: "z" } });
  });
});
