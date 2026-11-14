#!/usr/bin/env bun
/**
 * Build the static browser playground into dist/playground/ (deployable anywhere, e.g. GitHub
 * Pages under /<repo>/): the bundled tscad runtime + viewer + eval worker + editor, the kernel
 * wasm, every examples/*.tsx and the autocompletion data.
 *
 *   bun scripts/build-playground.ts            # minified build
 *   bun scripts/build-playground.ts --dev      # unminified
 *   bun scripts/build-playground.ts --serve 4600   # build, then serve dist/playground locally
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildApp, PKG_ROOT, SRC, WASM_DIR } from "../src/cli/bundle";
import { extractExports, extractIntrinsics, extractMaterials, extractSelectorMethods } from "../src/playground/extract";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const serveAt = args.includes("--serve") ? Number(args[args.indexOf("--serve") + 1]) || 4600 : 0;
const OUT = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]!) : resolve(PKG_ROOT, "dist/playground");
const t0 = performance.now();

export interface Example {
  name: string;
  title: string;
  description: string;
  source: string;
}

/** Title and description from an example's leading doc comment ("Title: description…"). */
export function describeExample(name: string, source: string): Example {
  const doc = source.match(/^\/\*\*([\s\S]*?)\*\//)?.[1] ?? "";
  const text = doc
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .filter((l) => l.trim() && !/^\s{2,}tscad /.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = text.split(/(?<=[.:—])\s/)[0] ?? "";
  const cut = text.match(/^(.{3,60}?)(?::| — |, )/);
  const title = (cut?.[1] ?? name.replace(/-/g, " ")).replace(/^"|"$/g, "").replace(/`/g, "").trim();
  const nice = title.charAt(0).toUpperCase() + title.slice(1);
  return { name, title: nice, description: (cut ? text.slice(cut[0].length) : firstSentence).trim().split(/(?<=\.)\s/)[0] ?? "", source };
}

async function build() {
  if (!existsSync(join(WASM_DIR, "tscad_wasm_bg.wasm"))) throw new Error("wasm/ is missing — run `bun run build:wasm` first");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // Library + viewer + worker + editor, with shared chunks (one tscad runtime instance).
  const assets = await buildApp({ entries: ["playground/main.ts"], minify: !dev });
  let jsBytes = 0;
  for (const [path, a] of assets) {
    if (path === "viewer/styles.css") continue;
    const dest = join(OUT, "__tscad", path);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, a.body);
    if (path.endsWith(".js")) jsBytes += typeof a.body === "string" ? a.body.length : a.body.byteLength;
  }
  const css = (await Bun.file(join(SRC, "viewer/styles.css")).text()) + "\n" + (await Bun.file(join(SRC, "playground/playground.css")).text());
  writeFileSync(join(OUT, "__tscad/styles.css"), css);

  // Kernel.
  mkdirSync(join(OUT, "wasm"), { recursive: true });
  for (const f of ["tscad_wasm.js", "tscad_wasm_bg.wasm"]) cpSync(join(WASM_DIR, f), join(OUT, "wasm", f));

  // Examples (bracket first, then alphabetical).
  const dir = join(PKG_ROOT, "examples");
  const examples: Example[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx")).sort()) {
    examples.push(describeExample(f.replace(/\.tsx$/, ""), await Bun.file(join(dir, f)).text()));
  }
  examples.sort((a, b) => (a.name === "bracket" ? -1 : b.name === "bracket" ? 1 : a.title.localeCompare(b.title)));
  writeFileSync(join(OUT, "examples.json"), JSON.stringify(examples));

  // Autocompletion data from the library's own sources.
  const completions = {
    tags: extractIntrinsics(await Bun.file(join(SRC, "core/intrinsics.ts")).text()),
    selectors: extractSelectorMethods(await Bun.file(join(SRC, "core/select.ts")).text()),
    exports: extractExports(await Bun.file(join(SRC, "index.ts")).text()),
    materials: extractMaterials(await Bun.file(join(SRC, "core/materials.ts")).text()),
  };
  writeFileSync(join(OUT, "completions.json"), JSON.stringify(completions));

  cpSync(join(SRC, "playground/index.html"), join(OUT, "index.html"));
  // GitHub Pages: serve `__tscad/` as is (Jekyll would hide underscore directories).
  writeFileSync(join(OUT, ".nojekyll"), "");

  const wasmBytes = statSync(join(OUT, "wasm/tscad_wasm_bg.wasm")).size;
  console.log(
    `✓ dist/playground in ${(performance.now() - t0).toFixed(0)} ms — js ${(jsBytes / 1e6).toFixed(2)} MB, wasm ${(wasmBytes / 1e6).toFixed(2)} MB, ${examples.length} examples, ${completions.tags.length} elements`,
  );
}

function serve(port: number) {
  const server = Bun.serve({
    port,
    fetch(req) {
      let path = decodeURIComponent(new URL(req.url).pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = resolve(OUT, `.${path}`);
      if (!file.startsWith(OUT) || !existsSync(file) || statSync(file).isDirectory()) return new Response("not found", { status: 404 });
      return new Response(Bun.file(file));
    },
  });
  console.log(`  serving http://localhost:${server.port}/`);
}

if (import.meta.main) {
  await build();
  if (serveAt) serve(serveAt);
}
