#!/usr/bin/env bun
/**
 * Release smoke test: pack tscad, install the tarball into a fresh project, and use it the way a
 * user would.
 *
 *   bun scripts/pack-check.ts            # pack, install, init, build, info, import every subpath
 *   bun scripts/pack-check.ts --keep     # keep the temp dir for poking around
 *
 * Checks:
 * 1. `bun pm pack` → the tarball ships the wasm (wasm/ is gitignored), src/, assets/, examples/,
 *    README and licences; reports its size.
 * 2. In a temp dir: `bun add <tarball>`, `bunx tscad init app`, install the tarball in the app,
 *    `tscad build index.tsx -o out.step -o out.stl`, `tscad info index.tsx --json`.
 * 3. A script imports every entry of package.json `exports` from the installed package.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

export interface PackReport {
  tarball: string;
  /** Bytes. */
  size: number;
  /** Bytes, unpacked. */
  unpacked: number;
  files: number;
  steps: { name: string; ok: boolean; millis: number; detail?: string }[];
  ok: boolean;
}

const REQUIRED = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE-MIT",
  "package/LICENSE-APACHE",
  "package/src/index.ts",
  "package/src/cli/index.ts",
  "package/src/core/intrinsics.ts",
  "package/wasm/tscad_wasm.js",
  "package/wasm/tscad_wasm_bg.wasm",
  "package/assets/fonts/LICENSE-DejaVu.txt",
  "package/examples/bracket.tsx",
];

async function sh(cmd: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", ...env } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  return { code, out: `${out}${err ? `\n${err}` : ""}`.trim() };
}

export async function packCheck(opts: { keep?: boolean; log?: (s: string) => void } = {}): Promise<PackReport> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const work = mkdtempSync(join(tmpdir(), "tscad-pack-"));
  const steps: PackReport["steps"] = [];
  const step = async (name: string, f: () => Promise<string | void>) => {
    const t0 = performance.now();
    try {
      const detail = (await f()) ?? undefined;
      steps.push({ name, ok: true, millis: performance.now() - t0, ...(detail ? { detail } : {}) });
      log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
    } catch (e) {
      steps.push({ name, ok: false, millis: performance.now() - t0, detail: (e as Error).message });
      log(`✗ ${name}: ${(e as Error).message}`);
    }
  };
  const must = (r: { code: number; out: string }, what: string) => {
    if (r.code !== 0) throw new Error(`${what} exited ${r.code}\n${r.out.slice(-2000)}`);
    return r.out;
  };

  let tarball = "", size = 0, unpacked = 0, files = 0;
  await step("pack", async () => {
    must(await sh(["bun", "pm", "pack", "--destination", work, "--quiet"], ROOT), "bun pm pack");
    tarball = join(work, `${pkg.name}-${pkg.version}.tgz`);
    size = statSync(tarball).size;
    return `${(size / 1e6).toFixed(1)} MB`;
  });
  await step("tarball contents", async () => {
    const list = must(await sh(["tar", "tzvf", tarball], work), "tar").split("\n");
    const names = list.map((l) => l.split(/\s+/).pop()!);
    files = names.length;
    unpacked = list.reduce((s, l) => s + (Number(l.split(/\s+/)[2]) || 0), 0);
    const missing = REQUIRED.filter((f) => !names.includes(f));
    if (missing.length) throw new Error(`missing from the tarball: ${missing.join(", ")}`);
    const junk = names.filter((n) => /\/(tests|target|dist|node_modules)\/|\.test\.tsx?$|\.spec\.tsx?$/.test(n));
    if (junk.length) throw new Error(`unexpected files in the tarball: ${junk.slice(0, 10).join(", ")}`);
    const wasm = list.find((l) => l.endsWith("wasm/tscad_wasm_bg.wasm"))!;
    return `${files} files, ${(unpacked / 1e6).toFixed(1)} MB unpacked, wasm ${(Number(wasm.split(/\s+/)[2]) / 1e6).toFixed(1)} MB`;
  });

  const home = join(work, "home");
  const app = join(home, "app");
  await step("install into a fresh project", async () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "package.json"), JSON.stringify({ name: "pack-check", private: true, type: "module" }));
    must(await sh(["bun", "add", tarball], home), "bun add");
  });
  await step("tscad init", async () => {
    must(await sh(["bunx", "tscad", "init", "app"], home), "tscad init");
    for (const f of ["index.tsx", "package.json", "tsconfig.json"]) statSync(join(app, f));
    // depend on the tarball, not the registry (0.1.0 isn't published yet)
    const appPkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
    if (appPkg.dependencies?.tscad !== `^${pkg.version}`) throw new Error(`init wrote tscad@${appPkg.dependencies?.tscad}, expected ^${pkg.version}`);
    appPkg.dependencies.tscad = `file:${tarball}`;
    writeFileSync(join(app, "package.json"), JSON.stringify(appPkg, null, 2));
    must(await sh(["bun", "install"], app), "bun install (app)");
    statSync(join(app, "node_modules/tscad/wasm/tscad_wasm_bg.wasm"));
  });
  await step("tscad build", async () => {
    must(await sh(["bunx", "tscad", "build", "index.tsx", "-o", "out.step", "-o", "out.stl"], app), "tscad build");
    const step = readFileSync(join(app, "out.step"), "utf8");
    if (!step.startsWith("ISO-10303-21;")) throw new Error("out.step is not STEP");
    const stl = statSync(join(app, "out.stl")).size;
    if (stl < 1000) throw new Error(`out.stl is only ${stl} bytes`);
    return `out.step ${(step.length / 1e3).toFixed(0)} kB, out.stl ${(stl / 1e3).toFixed(0)} kB`;
  });
  await step("tscad info", async () => {
    const out = must(await sh(["bunx", "tscad", "info", "index.tsx", "--json"], app), "tscad info");
    const info = JSON.parse(out.slice(out.indexOf("{")));
    const parts = info.parts as { name: string; ok: boolean; volume: number }[];
    if (!parts.length || !parts.every((p) => p.ok && p.volume > 0)) throw new Error(`bad parts: ${JSON.stringify(parts)}`);
    return parts.map((p) => `${p.name} ${p.volume.toFixed(0)} mm³`).join(", ");
  });
  await step("import every subpath export", async () => {
    const subpaths = Object.keys(pkg.exports as Record<string, string>).map((k) => (k === "." ? "tscad" : `tscad/${k.slice(2)}`));
    writeFileSync(
      join(app, "imports.ts"),
      `${subpaths.map((s, i) => `import * as m${i} from "${s}"`).join("\n")}\nconst mods = [${subpaths.map((_, i) => `m${i}`).join(", ")}]\nconsole.log(JSON.stringify(mods.map((m) => Object.keys(m).length)))\n`,
    );
    const out = must(await sh(["bun", "imports.ts"], app), "import script");
    const counts = JSON.parse(out.trim().split("\n").pop()!) as number[];
    const empty = subpaths.filter((s, i) => !counts[i] && s !== "tscad/ir");
    if (empty.length) throw new Error(`no runtime exports from ${empty.join(", ")}`);
    return `${subpaths.length} subpaths`;
  });
  await step("kernel + model from the installed package", async () => {
    writeFileSync(
      join(app, "eval.tsx"),
      `import { compile } from "tscad"\nimport { loadKernel } from "tscad/kernel"\nimport { checkWatertight } from "tscad/check"\nimport { toDXF } from "tscad/drawing"\nimport { CounterboreHole } from "tscad/parts"\n` +
        `const k = await loadKernel()\nconst r = compile(<part name="p"><difference><box size={[20, 20, 6]} /><CounterboreHole size="M3" depth={6} z={6} /></difference></part>)\n` +
        `const e = await k.evaluate(r.document)\nconst m = await k.mesh("p")\nconst d = compile(<drawing name="g"><text size={6}>ok</text></drawing>)\n` +
        `console.log(JSON.stringify({ ok: e.ok, volume: e.parts[0].volume, watertight: checkWatertight(m).watertight, dxf: toDXF(d.drawings).includes("POLYLINE") }))\n`,
    );
    const out = must(await sh(["bun", "eval.tsx"], app), "eval script");
    const r = JSON.parse(out.trim().split("\n").pop()!);
    if (!r.ok || !r.watertight || !r.dxf || !(r.volume > 2000)) throw new Error(`unexpected: ${out}`);
    return `volume ${r.volume.toFixed(1)} mm³, watertight, text → DXF`;
  });

  const ok = steps.every((s) => s.ok);
  if (!opts.keep) rmSync(work, { recursive: true, force: true });
  else log(`kept ${work}`);
  return { tarball, size, unpacked, files, steps, ok };
}

if (import.meta.main) {
  const r = await packCheck({ keep: process.argv.includes("--keep") });
  console.log(`\n${r.ok ? "PASS" : "FAIL"} — tarball ${(r.size / 1e6).toFixed(1)} MB (${(r.unpacked / 1e6).toFixed(1)} MB unpacked, ${r.files} files)`);
  process.exit(r.ok ? 0 : 1);
}
