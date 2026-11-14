import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderModule } from "tscad";
import { cookbookMarkdown, RECIPES } from "../scripts/build-cookbook";
import { convertScad } from "../src/convert";

const ROOT = join(import.meta.dir, "..");

describe("cookbook", () => {
  test("docs/cookbook.md is generated from the recipes (run `bun scripts/build-cookbook.ts`)", () => {
    expect(readFileSync(join(ROOT, "docs/cookbook.md"), "utf8")).toBe(cookbookMarkdown());
  });
  for (const r of RECIPES) {
    test(`${r.file} compiles`, async () => {
      const mod = await import(join(ROOT, r.file));
      const res = renderModule(mod);
      expect(res.document.parts!.length + res.drawings.length).toBeGreaterThan(0);
      expect(res.warnings).toEqual([]);
    });
  }
  test("the hex-bit holder is exactly what `tscad convert` makes of the .scad", () => {
    const scad = readFileSync(join(ROOT, "examples/cookbook/hex-bit-holder.scad"), "utf8");
    expect(convertScad(scad, { name: "HexBitHolder" }).tsx).toBe(readFileSync(join(ROOT, "examples/cookbook/hex-bit-holder.tsx"), "utf8"));
  });
});
