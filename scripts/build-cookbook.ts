#!/usr/bin/env bun
/**
 * Generate docs/cookbook.md from the recipe models (each a complete runnable .tsx) and render
 * their pictures into docs/images/cookbook/.
 *
 *   bun scripts/build-cookbook.ts               # render images + write docs/cookbook.md
 *   bun scripts/build-cookbook.ts --no-render   # only the markdown
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

interface Recipe {
  /** Path from the repo root. */
  file: string;
  title: string;
  /** Extra markdown after the code (commands, the test file...). */
  after?: string;
  /** Extra markdown before the code. */
  before?: string;
  view?: string;
  /** Param overrides for the picture. */
  params?: Record<string, string>;
}

const RECIPES: Recipe[] = [
  { file: "examples/snap-box.tsx", title: "Rounded box with a snap-fit lid", view: "-60,30" },
  { file: "examples/cable-clip.tsx", title: "Cable clip" },
  { file: "examples/wall-hook.tsx", title: "Wall hook", view: "-35,20" },
  { file: "examples/hinge.tsx", title: "Pin hinge with joint limits" },
  { file: "examples/cookbook/gear-pair.tsx", title: "Gear pair with a `<gear>` coupling", after: "The involute outline comes from `involuteGear()` in [examples/spur-gear.tsx](../examples/spur-gear.tsx): models are modules, so import helpers from each other freely." },
  {
    file: "examples/cookbook/name-tag.tsx",
    title: "Engraved name tag (laser → DXF)",
    after: "```sh\ntscad build name-tag.tsx -o tag.dxf -p name=Ada   # outline on layer CUT, the name on ENGRAVE\ntscad build name-tag.tsx -o tag.svg                # cut lines black, engraving blue\n```",
  },
  { file: "examples/cookbook/pegboard-bin.tsx", title: "Pegboard bins", view: "130,25" },
  {
    file: "examples/cookbook/hex-bit-holder.tsx",
    title: "Hex-bit holder, converted from OpenSCAD",
    before: "Start from an existing OpenSCAD design:\n\n```scad\n{{scad:examples/cookbook/hex-bit-holder.scad}}\n```\n\n`tscad convert hex-bit-holder.scad -o hex-bit-holder.tsx` turns it into a tscad model. The customizer variables become typed params, the module becomes a component, the `for` loops become `.map`, and `cylinder($fn = 6)` becomes an exact hexagonal prism:",
  },
  {
    file: "examples/cookbook/printable-bracket.tsx",
    title: "A bracket that proves it prints without supports",
    after: "And its test, run with `bun test ./examples/`:\n\n```tsx\n{{src:examples/cookbook/printable-bracket.spec.tsx}}\n```\n\nIf a change adds an overhang, such as a round horizontal hole instead of a teardrop, the test fails and names the overhang area.",
    view: "-130,30",
  },
];

const slug = (s: string) => s.toLowerCase().replace(/<[^>]*>|`/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
const name = (file: string) => file.split("/").pop()!.replace(/\.tsx$/, "");
const image = (file: string) => `docs/images/cookbook/${name(file)}.png`;

function docOf(src: string): string {
  const m = src.match(/^\/\*\*([\s\S]*?)\*\//);
  if (!m) return "";
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim()
    .split(/\n\s*\n/)[0]!
    .replace(/\n/g, " ");
}

function expand(md: string): string {
  return md.replace(/\{\{(scad|src):([^}]+)\}\}/g, (_, _k, f) => readFileSync(join(ROOT, f), "utf8").trimEnd());
}

async function render(r: Recipe) {
  mkdirSync(join(ROOT, "docs/images/cookbook"), { recursive: true });
  const args = ["bun", "src/cli/index.ts", "render", r.file, "-o", image(r.file), "--width", "900", "--height", "600"];
  if (r.view) args.push("--view", r.view);
  for (const [k, v] of Object.entries(r.params ?? {})) args.push("-p", `${k}=${v}`);
  const p = Bun.spawn(args, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if ((await p.exited) !== 0) throw new Error(`render ${r.file} failed: ${await new Response(p.stderr).text()}`);
  console.log(`✓ ${image(r.file)}`);
}

export function cookbookMarkdown(): string {
  const parts: string[] = [
    "# Cookbook",
    "",
    "Short, complete recipes. Each one is a runnable model in the repository: open it in `tscad dev`, change the params, and build it. They're also good starting points to copy from.",
    "",
    ...RECIPES.map((r) => `- [${r.title.replace(/`/g, "")}](#${slug(r.title)})`),
    "",
  ];
  for (const r of RECIPES) {
    const src = readFileSync(join(ROOT, r.file), "utf8");
    parts.push(
      `## ${r.title}`,
      "",
      docOf(src),
      "",
      `<p><img src="images/cookbook/${name(r.file)}.png" alt="${r.title.replace(/`|"/g, "")}" width="720"></p>`,
      "",
      ...(r.before ? [expand(r.before), ""] : []),
      "```tsx",
      src.trimEnd(),
      "```",
      "",
      `[${r.file}](../${r.file}) · \`tscad dev ${r.file}\``,
      "",
      ...(r.after ? [expand(r.after), ""] : []),
    );
  }
  return parts.join("\n");
}

if (import.meta.main) {
  if (!process.argv.includes("--no-render")) for (const r of RECIPES) await render(r);
  for (const r of RECIPES) if (!existsSync(join(ROOT, image(r.file)))) console.warn(`! missing ${image(r.file)}`);
  writeFileSync(join(ROOT, "docs/cookbook.md"), cookbookMarkdown());
  console.log(`✓ docs/cookbook.md (${RECIPES.length} recipes)`);
}

export { RECIPES };
