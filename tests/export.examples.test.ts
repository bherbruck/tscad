import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { renderModule } from "../src/index";

const dir = new URL("../examples/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.startsWith("_"));

// Every example compiles to IR with its default params (evaluation is covered by the CLI build).
describe("examples compile", () => {
  for (const file of files) {
    test(file, async () => {
      const mod = await import(new URL(file, dir).href);
      expect(typeof mod.default).toBe("function");
      expect(mod.params).toBeDefined();
      const r = renderModule(mod);
      expect(r.document.parts?.length).toBeGreaterThan(0);
      for (const p of r.document.parts!) expect(p.name).toBeTruthy();
    });
  }
});
