/** Regression tests for the friction found by dogfooding the MCP server (docs/mcp-dogfood.md). */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, createElement, renderModule } from "tscad";
import * as parts from "tscad/parts";
import { PARTS_COMPONENTS } from "../src/core/compile";
import { createMcpHandler } from "../src/mcp";

const h = createMcpHandler();
const call = async (name: string, args: Record<string, unknown>) => ((await h({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as any).result;
const text = (r: any) => r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

describe("error hints", () => {
  test("rotate={90}, 2-number box size, unknown lowercase parts component", () => {
    expect(() => compile(createElement("cylinder", { r: 2, h: 5, rotate: 90 }))).toThrow(/rotateZ=\{90\}/);
    try {
      // a component returning the element directly: no source location
      renderModule({ default: () => createElement("hole", { size: "M3" }) });
      throw new Error("no throw");
    } catch (e) {
      expect((e as Error).message).toContain('import { Hole } from "tscad/parts"');
      expect((e as Error).message).toContain('(in <hole size={"M3"}>)'); // no source location → says which element
    }
  });
  test("every tscad/parts component is known to the hint", () => {
    const components = Object.keys(parts).filter((k) => /^[A-Z]/.test(k) && typeof (parts as any)[k] === "function");
    expect([...PARTS_COMPONENTS].sort()).toEqual(components.sort());
  });
  test("MCP: a missing import says what to import; an error without a location is found in the source", async () => {
    const missing = await call("tscad_evaluate", { source: 'export default () => <Hole size="M3" />' });
    expect(text(missing)).toContain('hint: import { Hole } from "tscad/parts"');
    const noLoc = await call("tscad_evaluate", { source: "export default () => (\n  <cylinder r={2} h={5} rotate={90} />\n)" });
    expect(text(noLoc)).toContain("at model.tsx:2:3");
    expect(text(noLoc)).toContain("rotateZ={90}");
  }, 30_000);
});

describe("tool outputs", () => {
  test("tscad_check suggests a better print orientation", async () => {
    // a lid: open at the bottom, so its ceiling overhangs unless printed upside down
    const r = await call("tscad_check", { source: 'import { faces } from "tscad"\nexport default () => <part name="lid"><shell thickness={2} open={faces.bottom()}><box size={[40, 30, 10]} /></shell></part>' });
    expect(r.structuredContent.parts[0].betterOrientation.buildDir).toEqual([0, 0, -1]);
    expect(text(r)).toContain("print it with buildDir [0, 0, -1] (upside down)");
  }, 30_000);
  test("tscad_pick_selectors offers a box selector when no geometric one isolates the item", async () => {
    const r = await call("tscad_pick_selectors", { source: 'export default () => <part name="p"><difference><box size={[40, 20, 10]} /><box size={[10, 30, 20]} /></difference></part>', point: [-5, 0, 5], kind: "face" });
    const within = r.structuredContent.suggestions.find((s: any) => s.selector.type === "within");
    expect(within).toBeDefined();
    expect(within.code).toStartWith("faces.within(");
  }, 30_000);
  test("tscad_export names the drawings it wrote for DXF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tscad-df-"));
    try {
      const r = await call("tscad_export", { source: 'export default () => <><drawing name="a" thickness={3}><rect w={10} h={10} /></drawing></>', format: "dxf", path: join(dir, "a.dxf") });
      expect(text(r)).toContain("drawings: a");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("docs", () => {
  test("the guide covers assemblies, printing and common mistakes; the index is grouped", async () => {
    const g = text(await call("tscad_docs", {}));
    for (const s of ["## Assemblies: anchors and mates", "## Printing", "## Common mistakes", "There are no 2D booleans", "Constraint sketch (inside <sketch>)"]) expect(g).toContain(s);
  });
  test("type names are explained; mount patterns are tabulated (with the Pi 5)", async () => {
    expect(text(await call("tscad_docs", { element: "split" }))).toContain('PlaneSpec = `"XY"` (normal +Z)');
    const p = text(await call("tscad_docs", { topic: "parts" }));
    expect(p).toContain("| `raspberryPi5` | 58 × 49 | M2.5 | 85 × 56 |");
  });
});

describe("examples/agent", () => {
  for (const f of readdirSync(join(import.meta.dir, "../examples/agent")).filter((f) => f.endsWith(".tsx"))) {
    test(`${f} compiles`, async () => {
      const r = renderModule(await import(`../examples/agent/${f}`));
      expect(r.document.parts!.length).toBeGreaterThan(0);
      expect(r.warnings).toEqual([]);
    });
  }
});
