import { describe, expect, test } from "bun:test";
import { annotate, bspline } from "../src/viewer/sketch-overlay";
import { tagRange } from "../src/playground/source-range";
import type { SketchDimensionData } from "../src/viewer/protocol";
import { renderModule } from "../src";

const dim = (kind: SketchDimensionData["kind"], points: [number, number][], text = "x"): SketchDimensionData => ({ kind, value: 0, text, points });

describe("sketch overlay geometry", () => {
  test("a length gets two extension lines, a dimension line and two arrows, labelled off the part", () => {
    const a = annotate(dim("length", [[0, 0], [40, 0]]), 50, [20, 10])!;
    // 2 extension + 1 dimension line + 2×2 arrow strokes
    expect(a.segments.length).toBe(7);
    // The sketch's middle is above the line, so the dimension goes below it.
    expect(a.label[1]).toBeLessThan(0);
    expect(a.label[0]).toBeCloseTo(20, 6);
  });

  test("dx stays horizontal and stacked levels step outwards", () => {
    const d = dim("dx", [[0, 0], [30, 5]]);
    const l0 = annotate(d, 50, [15, 20], 0)!, l1 = annotate(d, 50, [15, 20], 1)!;
    const dimLine0 = l0.segments[2]!;
    expect(dimLine0[1]).toBeCloseTo(dimLine0[3], 9); // horizontal
    expect(Math.abs(dimLine0[2] - dimLine0[0])).toBeCloseTo(30, 9);
    expect(l1.label[1]).toBeLessThan(l0.label[1]);
  });

  test("radius, diameter and angle", () => {
    expect(annotate(dim("radius", [[0, 0], [5, 0]]), 20, [0, 0])!.segments[0]).toEqual([0, 0, 5, 0]);
    const dia = annotate(dim("diameter", [[0, 0], [5, 0]]), 20, [0, 0])!;
    expect(dia.segments[0]).toEqual([-5, 0, 5, 0]);
    const ang = annotate(dim("angle", [[0, 0], [10, 0], [0, 10]]), 20, [5, 5])!;
    expect(ang.label[0]).toBeGreaterThan(0);
    expect(ang.label[1]).toBeGreaterThan(0);
    expect(annotate(dim("length", [[1, 1], [1, 1]]), 20, [0, 0])).toBeUndefined();
  });

  test("clamped B-spline passes through its end control points", () => {
    const pts = bspline([[0, 0], [10, 20], [20, -20], [30, 0]], 3);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([30, 0]);
    expect(pts.length).toBeGreaterThan(20);
  });
});

describe("click-to-source ranges", () => {
  const text = `x\n  <line from="a" to="b" horizontal length={p.w / 2} />\n  <dimension a={s.q0} b="q1" dy={p.f(() => 1)} />`;
  test("the opening tag, or one prop's attribute", () => {
    const line = text.indexOf("<line");
    let r = tagRange(text, line)!;
    expect(text.slice(r.from, r.to)).toBe(`<line from="a" to="b" horizontal length={p.w / 2} />`);
    r = tagRange(text, line + 3, ["length"])!;
    expect(text.slice(r.from, r.to)).toBe("length={p.w / 2}");
    const d = text.indexOf("<dimension");
    r = tagRange(text, d, ["dx", "dy"])!;
    expect(text.slice(r.from, r.to)).toBe("dy={p.f(() => 1)}");
    r = tagRange(text, d, ["radius"])!;
    expect(text.slice(r.from, r.to).endsWith("/>")).toBe(true);
  });
});

describe("sketch data contract", () => {
  for (const f of ["sketch-link-arm", "sketch-pulley"]) {
    test(`${f}: every field the overlay draws`, async () => {
      const r = renderModule(await import(`../examples/${f}.tsx`));
      expect(r.sketches.length).toBeGreaterThan(0);
      for (const s of r.sketches) {
        expect(s.plane.length).toBe(16);
        expect(["ok", "under"]).toContain(s.status);
        expect(s.loc?.line).toBeGreaterThan(0);
        for (const e of s.entities) expect(["line", "arc", "circle", "spline"]).toContain(e.kind);
        for (const d of s.dimensions) {
          expect(d.text.length).toBeGreaterThan(0);
          expect(d.points.length).toBeGreaterThanOrEqual(2);
          expect(annotate(d as SketchDimensionData, 100, [0, 0])).toBeDefined();
        }
      }
    });
  }
});

describe("sketch patterns contract", () => {
  test("sketch-flange: copies point at their originals and patterns carry what the overlay draws", async () => {
    const r = renderModule(await import("../examples/sketch-flange.tsx"));
    const s = r.sketches.find((x: any) => x.patterns?.length) as any;
    expect(s).toBeDefined();
    for (const p of s.patterns) {
      for (const copy of p.copies) expect(copy.length).toBe(p.of.length);
      if (p.kind === "mirror") expect(p.axis.length).toBe(2);
      if (p.kind === "circular") expect(p.center.length).toBe(2);
    }
    const copies = s.entities.filter((e: any) => e.copyOf);
    expect(copies.length).toBeGreaterThan(0);
    for (const e of copies) expect(s.patterns[e.copyOf.pattern].of).toContain(e.copyOf.index);
  });
});
