/**
 * Render snapshots of every example: evaluated with default params, rendered headless
 * (`tscad/render`) at 256 × 192, iso (plus top for flat and sheet-metal parts), and compared with
 * tests/__snapshots__/<name>.<view>.png. Missing snapshots are written;
 * `TSCAD_UPDATE_SNAPSHOTS=1 bun test tests/snapshots.test.ts` rewrites them. A mismatch writes
 * <name>.<view>.diff.png (gitignored) and prints its path.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateModel, matchRenderSnapshot, type ModelResult } from "../src/testing";
import { loadKernel, WasmKernelHost } from "../src/kernel";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(import.meta.dir, "__snapshots__");
const GROUPS = ["", "cookbook", "agent", "converted"];

/** Every example (top level and its folders), without tests/specs: `[snapshot name, file]`. */
const EXAMPLES: [string, string][] = GROUPS.flatMap((g) =>
  readdirSync(join(ROOT, "examples", g))
    .filter((f) => f.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(f))
    .sort()
    .map((f): [string, string] => [(g ? `${g}-` : "") + f.replace(/\.tsx$/, ""), join(ROOT, "examples", g, f)]),
);

/** Flat parts (plates, tags, laser parts) and sheet metal also get a top view. */
function views(r: ModelResult, file: string): ("iso" | "top")[] {
  const [x, y, z] = r.size();
  const flat = z <= 0.25 * Math.max(x, y);
  return flat || /sheet/.test(file) || r.compiled.drawings.length > 0 ? ["iso", "top"] : ["iso"];
}

describe("render snapshots", () => {
  for (const [name, file] of EXAMPLES) {
    test(name, async () => {
      const r = await evaluateModel(await import(file));
      expect(r.describeErrors()).toBe("");
      if (!r.meshes.size) return; // drawings only: nothing to render
      for (const view of views(r, file)) {
        const res = await matchRenderSnapshot(r, { name, view, dir: DIR });
        if (!res.pass) console.error(res.message);
        expect(res.pass, res.message).toBe(true);
      }
    }, 120_000);
  }
});

describe("native and wasm kernels render the same", () => {
  const SAMPLE = ["bracket", "spur-gear", "sheet-l-bracket", "cookbook-gear-pair"];
  for (const name of SAMPLE) {
    test(name, async () => {
      const native = await loadKernel();
      if (native instanceof WasmKernelHost) return; // no native library here: nothing to compare
      const wasm = await WasmKernelHost.create();
      try {
        const file = EXAMPLES.find(([n]) => n === name)![1];
        const r = await evaluateModel(await import(file), {}, { kernel: wasm });
        const res = await matchRenderSnapshot(r, { name, dir: DIR, update: false });
        expect(res.pass, `wasm render vs the (native) snapshot: ${res.message}`).toBe(true);
      } finally {
        wasm.dispose();
      }
    }, 120_000);
  }
});
