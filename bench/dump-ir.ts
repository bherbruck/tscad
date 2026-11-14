/**
 * Render every example (and a few heavier variants and synthetic workloads) to IR documents in
 * bench/ir/<name>.json, for the native profiler (crates/tscad-wasm/tests/perf_profile.rs).
 *   bun bench/dump-ir.ts
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { compile, renderModule } from "../src/index";
import * as W from "./workloads";

const root = join(import.meta.dir, "..");
const out = join(import.meta.dir, "ir");
mkdirSync(out, { recursive: true });

export function exampleFiles(): string[] {
  return readdirSync(join(root, "examples")).filter((f) => f.endsWith(".tsx") && !f.startsWith("_") && !/\.(spec|test)\.tsx$/.test(f));
}

/** name → [example file, param overrides] for the heavier variants. */
export const VARIANTS: Record<string, [string, Record<string, unknown>]> = {
  "spur-gear+toothChamfer": ["spur-gear.tsx", { toothChamfer: true }],
};

export const SYNTHETIC: Record<string, () => unknown> = {
  "synthetic-plate24": W.Plate24,
  "synthetic-sphere-chain": W.SphereChain,
  "synthetic-helix-sweep": W.HelixSweep,
  "synthetic-fillet-all": W.FilletAll,
  "synthetic-curved-booleans": W.CurvedBooleans,
};

if (import.meta.main) {
  for (const f of exampleFiles()) {
    const { document } = renderModule(await import(join(root, "examples", f)));
    writeFileSync(join(out, `${basename(f, ".tsx")}.json`), JSON.stringify(document));
  }
  for (const [name, [f, over]] of Object.entries(VARIANTS)) {
    const { document } = renderModule(await import(join(root, "examples", f)), over);
    writeFileSync(join(out, `${name}.json`), JSON.stringify(document));
  }
  for (const [name, C] of Object.entries(SYNTHETIC)) {
    const { document } = compile((C as any)());
    writeFileSync(join(out, `${name}.json`), JSON.stringify(document));
  }
  console.log(readdirSync(out).length, "IR documents in", out);
}
