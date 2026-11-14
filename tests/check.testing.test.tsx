import { describe, expect, test } from "bun:test";
import { defineParams, type ParamValues } from "tscad";
import { evaluateModel, forEachParamCombo, paramCombos } from "tscad/testing";

const params = defineParams({
  w: { type: "number", default: 20, min: 10, max: 40, step: 0.5 },
  n: { type: "int", default: 2, min: 1, max: 4 },
  round: { type: "boolean", default: false },
  style: { type: "choice", default: "a", options: ["a", "b", "c"] },
  label: { type: "text", default: "x" },
});

describe("paramCombos", () => {
  test("every discrete combination × LHS numeric samples, plus defaults", () => {
    const c = paramCombos(params, { samples: 3, seed: 7 });
    expect(c[0]).toEqual({ w: 20, n: 2, round: false, style: "a", label: "x" });
    expect(c.length).toBe(1 + 2 * 3 * 3);
    for (const v of c) {
      expect(v.w).toBeGreaterThanOrEqual(10);
      expect(v.w).toBeLessThanOrEqual(40);
      expect(Number.isInteger(v.w * 2)).toBe(true); // step 0.5
      expect(Number.isInteger(v.n)).toBe(true);
      expect(v.label).toBe("x");
    }
    // LHS: the 3 samples of one discrete combo fall in different thirds of the range
    const ws = c.filter((v, i) => i > 0 && !v.round && v.style === "a").map((v) => v.w).sort((a, b) => a - b);
    expect(ws[0]!).toBeLessThanOrEqual(20);
    expect(ws[2]!).toBeGreaterThanOrEqual(30);
    // reproducible
    expect(paramCombos(params, { samples: 3, seed: 7 })).toEqual(c);
  });
  test("corners, fixed, only, cap", () => {
    const corners = paramCombos(params, { method: "corners", only: ["w", "n"], defaults: false });
    expect(corners).toEqual([
      { w: 10, n: 1, round: false, style: "a", label: "x" },
      { w: 10, n: 4, round: false, style: "a", label: "x" },
      { w: 40, n: 1, round: false, style: "a", label: "x" },
      { w: 40, n: 4, round: false, style: "a", label: "x" },
    ]);
    expect(paramCombos(params, { fixed: { style: "b", round: true }, samples: 2 }).every((v) => v.style === "b" && v.round)).toBe(true);
    expect(paramCombos(params, { samples: 10, max: 5 }).length).toBe(5);
  });
});

function Plate({ w, n }: ParamValues<typeof params>) {
  return (
    <part name="plate" material="pla">
      <extrude height={2}>
        <rect w={w} h={10} />
        {Array.from({ length: n }, (_, i) => (
          <circle key={i} r={1} x={(i - (n - 1) / 2) * 3} />
        ))}
      </extrude>
    </part>
  );
}
const plate = { default: Plate, params };

describe("matchers", () => {
  test("toEvaluate / toHaveVolume / toFitIn / toBePrintable", async () => {
    const r = await evaluateModel(plate, { w: 30, n: 2 });
    expect(r).toEvaluate();
    expect(r).toHaveVolume(30 * 10 * 2 - 2 * Math.PI * 2);
    expect(r).not.toHaveVolume(1000);
    expect(r).toFitIn([31, 11, 3]);
    expect(r).not.toFitIn([29, 11, 3]);
    expect(r.mass()).toBeCloseTo(((600 - 4 * Math.PI) / 1000) * 1.24, 6);
    expect(r).toBePrintable({ minWall: 0.8, bed: [200, 200, 200] });
    expect(r).not.toBePrintable({ bed: [20, 20, 20] });
  }, 30_000);

  test("failures are reported, not thrown", async () => {
    const bad = await evaluateModel(<cylinder r={-1} h={2} />);
    expect(bad).not.toEvaluate();
    expect(bad.describeErrors()).toContain("greater than 0");
    let msg = "";
    try {
      expect(bad).toEvaluate();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("expected the model to evaluate");
  }, 30_000);

  test("toHaveNoInterference (async)", async () => {
    const ok = await evaluateModel(
      <assembly>
        <part name="a"><box size={10} /></part>
        <part name="b" x={12}><box size={10} /></part>
      </assembly>,
    );
    await expect(ok).toHaveNoInterference();
    const clash = await evaluateModel(
      <assembly>
        <part name="a"><box size={10} /></part>
        <part name="b" x={8}><box size={10} /></part>
      </assembly>,
    );
    await expect(clash).not.toHaveNoInterference();
    expect((await clash.interference()).pairs[0]!.volume).toBeCloseTo(200, 6);
  }, 30_000);

  test("forEachParamCombo sweeps a model", async () => {
    const seen: number[] = [];
    const n = await forEachParamCombo(params, { samples: 2, only: ["w", "n"] }, async (p) => {
      const r = await evaluateModel(plate, p);
      expect(r).toEvaluate();
      seen.push(r.volume());
    });
    expect(n).toBe(3);
    expect(seen.length).toBe(3);
  }, 60_000);
});
