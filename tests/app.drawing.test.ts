import { describe, expect, test } from "bun:test";
import { renderModule } from "../src";
import { drawingData } from "../src/viewer/drawing-data";
import { drawingMeta } from "../src/viewer/fmt";
import * as bracket from "../examples/sheet-l-bracket";

describe("viewer drawing data", () => {
  const drawings = renderModule(bracket).drawings ?? [];

  test("open paths (sheet-metal bend lines) become segments; notes come along", () => {
    const bends = drawings.find((d) => d.name.endsWith("-bends"))!;
    expect(bends.loops.length).toBe(0);
    expect(bends.paths?.length).toBeGreaterThan(0);
    const data = drawingData(bends);
    expect(data.loops).toBe(0);
    expect(data.paths).toBe(bends.paths!.length);
    // one straight bend line each: 6 floats per segment
    expect(data.segments.length).toBe(bends.paths!.length * 6);
    if (bends.notes?.length) {
      expect(data.notes?.length).toBe(bends.notes.length);
      for (const n of data.notes!) {
        expect(n.text.length).toBeGreaterThan(0);
        expect(n.size).toBeGreaterThan(0);
      }
    }
  });

  test("closed loops still become segments", () => {
    const flat = drawings.find((d) => d.name.endsWith("-flat"))!;
    const data = drawingData(flat);
    expect(data.loops).toBe(flat.loops.length);
    expect(data.segments.length).toBeGreaterThan(0);
    expect(data.segments.length % 6).toBe(0);
  });

  test("the parts-list / CLI summary counts loops, lines and notes", () => {
    expect(drawingMeta({ loops: 6 })).toBe("drawing · 6 loops");
    expect(drawingMeta({ loops: 0, paths: 2, notes: [1, 2] })).toBe("drawing · 2 lines · 2 notes");
    expect(drawingMeta({ loops: 1, paths: 1, notes: [1] })).toBe("drawing · 1 loop · 1 line · 1 note");
  });
});
