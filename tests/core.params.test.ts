import { describe, expect, test } from "bun:test";
import { defineParams, paramDefaults, paramLabel, renderModule, resolveParams, type ParamValues } from "tscad";
import { createElement } from "tscad";

const params = defineParams({
  width: { type: "number", default: 40, min: 10, max: 120, step: 1, unit: "mm", label: "Width" },
  holes: { type: "int", default: 4, min: 0, max: 12 },
  rounded: { type: "boolean", default: true },
  style: { type: "choice", default: "a", options: ["a", "b"] },
  teeth: { type: "choice", default: 12, options: [12, 24, 36] },
  label: { type: "text", default: "hi", maxLength: 4 },
  tint: { type: "color", default: "#ff0000", group: "Look" },
});

describe("params", () => {
  test("type inference", () => {
    type V = ParamValues<typeof params>;
    const v: V = paramDefaults(params);
    const w: number = v.width;
    const s: "a" | "b" = v.style;
    const t: 12 | 24 | 36 = v.teeth;
    const b: boolean = v.rounded;
    const l: string = v.label;
    // @ts-expect-error not an option
    const bad: V["style"] = "c";
    void [w, s, t, b, l, bad];
    expect(v).toEqual({ width: 40, holes: 4, rounded: true, style: "a", teeth: 12, label: "hi", tint: "#ff0000" });
  });

  test("defineParams rejects a choice default that isn't an option", () => {
    // @ts-expect-error default must be an option
    expect(() => defineParams({ s: { type: "choice", default: "z", options: ["a", "b"] } })).toThrow(/not one of the options/);
    expect(() => defineParams({ n: { type: "number", default: 1, min: 5, max: 2 } })).toThrow(/min/);
  });

  test("resolveParams coerces and clamps", () => {
    const { values, issues } = resolveParams(params, { width: "500", holes: 2.6, rounded: "false", style: "b", teeth: "24", label: "hello", nope: 1 });
    expect(values.width).toBe(120);
    expect(values.holes).toBe(3);
    expect(values.rounded).toBe(false);
    expect(values.style).toBe("b");
    expect(values.teeth).toBe(24);
    expect(values.label).toBe("hell");
    expect(issues.map((i) => i.key).sort()).toEqual(["holes", "label", "nope", "width"]);
    expect(resolveParams(params, { width: 5 }).values.width).toBe(10);
    expect(resolveParams(params, { width: "abc" }).values.width).toBe(40);
    expect(resolveParams(params, { style: "zzz" }).values.style).toBe("a");
  });

  test("labels", () => {
    expect(paramLabel("wallThickness", { type: "number", default: 1 })).toBe("Wall thickness");
    expect(paramLabel("width", params.width)).toBe("Width");
  });

  test("renderModule merges overrides and compiles", () => {
    const mod = {
      params,
      default: (p: ParamValues<typeof params>) => createElement("box", { size: [p.width, 10, p.holes] }),
    };
    const r = renderModule(mod, { width: 50, holes: 99 });
    expect(r.values.width).toBe(50);
    expect(r.values.holes).toBe(12);
    expect(r.params).toBe(params);
    expect(r.document.parts![0]!.name).toBe("part");
    const t = r.document.parts![0]!.node as any;
    expect(t.children[0].size).toEqual([50, 10, 12]);
    expect(r.warnings.some((w) => w.includes("holes"))).toBe(true);
  });

  test("renderModule without params or default export", () => {
    expect(renderModule({ default: () => createElement("sphere", { r: 1 }) }).values).toEqual({});
    expect(() => renderModule({} as any)).toThrow(/default export/);
  });
});
