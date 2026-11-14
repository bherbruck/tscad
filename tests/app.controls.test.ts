import { describe, expect, test } from "bun:test";
import { MOUSE, TOUCH } from "three";
import { loadMouseScheme, MOUSE_SCHEMES, mouseButtonsFor, mouseHelp, saveMouseScheme, TOUCH_MAP } from "../src/viewer/controls";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("viewport mouse schemes", () => {
  test("CAD (default): right orbits, middle pans, left never moves the camera", () => {
    expect(mouseButtonsFor("cad")).toEqual({ LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE });
  });

  test("classic: left orbits, right pans, middle zooms (three.js defaults)", () => {
    expect(mouseButtonsFor("classic")).toEqual({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN });
  });

  test("touch: one finger orbits, two fingers pinch-zoom and pan", () => {
    expect(TOUCH_MAP).toEqual({ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN });
  });

  test("the choice is remembered; default and junk values are CAD; storage errors are ignored", () => {
    const s = memory();
    expect(loadMouseScheme(s)).toBe("cad");
    saveMouseScheme("classic", s);
    expect(loadMouseScheme(s)).toBe("classic");
    s.setItem("tscad.mouse", "nonsense");
    expect(loadMouseScheme(s)).toBe("cad");
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadMouseScheme(broken)).toBe("cad");
    expect(() => saveMouseScheme("cad", broken)).not.toThrow();
    expect(loadMouseScheme(undefined)).toBe("cad");
  });

  test("help text matches each scheme; every scheme is offered in settings", () => {
    expect(mouseHelp("cad")).toMatch(/right-drag to orbit.*middle-drag to pan.*scroll to zoom/i);
    expect(mouseHelp("classic")).toMatch(/drag to orbit.*right-drag to pan/i);
    expect(MOUSE_SCHEMES.map((m) => m.id)).toEqual(["cad", "classic"]);
    for (const m of MOUSE_SCHEMES) expect(mouseHelp(m.id)).not.toContain("—");
  });
});
