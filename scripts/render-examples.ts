/**
 * Render every example to docs/images/<name>.png (and <name>-light.png with --light).
 *   bun scripts/render-examples.ts [name...] [--light] [--width 1200] [--height 800]
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { renderModule } from "../src/index";
import { loadKernel } from "../src/kernel";
import { renderPNG, type RenderOptions, type RenderPart } from "../src/render";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const width = Number(flag("--width") ?? 1200);
const height = Number(flag("--height") ?? 800);
const light = args.includes("--light");
const names = args.filter((a) => !a.startsWith("--"));

/** Per-example camera tweaks (everything else uses the default iso view). */
const VIEWS: Record<string, RenderOptions["view"]> = {
  "spur-gear": { azimuth: -60, elevation: 38 },
  coaster: { azimuth: -60, elevation: 42 },
  "phone-stand": { azimuth: -130, elevation: 22 },
  vase: { azimuth: -58, elevation: 18 },
  "bolt-and-nut": { azimuth: -50, elevation: 20 },
  bracket: { azimuth: 55, elevation: 28 },
};

const files = readdirSync(join(root, "examples"))
  .filter((f) => f.endsWith(".tsx") && !f.startsWith("_"))
  .filter((f) => !names.length || names.includes(basename(f, ".tsx")));
const kernel = await loadKernel();
for (const f of files) {
  const name = basename(f, ".tsx");
  const t0 = performance.now();
  const mod = await import(join(root, "examples", f));
  const { document } = renderModule(mod);
  const res = await kernel.evaluate(document);
  if (!res.ok) {
    console.error(`✗ ${name}: ${res.parts.filter((p) => !p.ok).map((p) => p.error?.message).join("; ")}`);
    continue;
  }
  const parts: RenderPart[] = [];
  for (const p of document.parts ?? []) parts.push({ name: p.name!, color: p.color, mesh: await kernel.meshAt(p.name!, 0.02) });
  const t1 = performance.now();
  for (const bg of light ? (["dark", "light"] as const) : (["dark"] as const)) {
    const png = renderPNG(parts, { width, height, view: VIEWS[name], background: bg });
    const out = join(root, "docs", "images", `${name}${bg === "light" ? "-light" : ""}.png`);
    await Bun.write(out, png);
    console.log(`✓ ${name}${bg === "light" ? " (light)" : ""}: ${(png.length / 1024).toFixed(0)} kB, model ${((t1 - t0) / 1000).toFixed(1)} s, render ${((performance.now() - t1) / 1000).toFixed(1)} s`);
  }
}
