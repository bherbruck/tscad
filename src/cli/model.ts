/**
 * Run a user model in bun: import it (with `tscad` pinned to this package so there is one
 * runtime instance), render with params, evaluate with the kernel, and map errors to TSX lines.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type { BunPlugin } from "bun";
import { BundleError, PKG_ROOT, RUNTIME_ENTRIES, SRC } from "./bundle";
import { loadKernel, type KernelHost, WasmKernelHost } from "../kernel";
import { renderModule, type RenderResult } from "../index";
import type { EvalResult, PartResult } from "../ir";
import { c, codeFrame } from "./ui";

/** Resolve `tscad` and `tscad/*` to this package's sources (external), so there is one runtime. */
function runtimePlugin(): BunPlugin {
  return {
    name: "tscad-runtime-local",
    setup(build) {
      build.onResolve({ filter: /^tscad(\/[\w-]+)?$/ }, (args) => {
        const sub = args.path.slice("tscad/".length);
        const candidates = [RUNTIME_ENTRIES[args.path], `${sub}/index.ts`, `${sub}.ts`].filter(Boolean).map((e) => resolve(SRC, e!));
        const path = candidates.find((p) => existsSync(p)) ?? candidates[0]!;
        return { path, external: true };
      });
    },
  };
}

let generation = 0;
const outDir = join(tmpdir(), `tscad-cli-${process.pid}`);

/** A model module: its default export is the model component (renderModule checks this). */
export type ModelModule = Parameters<typeof renderModule>[0];

/**
 * Import the model module, fresh each call. It is bundled with Bun.build first (JSX → tscad
 * whatever the user's tsconfig says; `tscad` pinned to this package) and its source map
 * points at the original files, so stack traces and source locations name the TSX lines.
 */
export async function importModel(file: string): Promise<ModelModule> {
  const b = await bundleModel(file);
  try {
    return await import(b.path);
  } finally {
    rmSync(b.path, { force: true });
  }
}

/** A model bundled for bun (server-side evaluation). */
export interface BunBundle {
  /** The bundled module, written to a temp file (delete it when done). */
  path: string;
  /** Its source map (sources absolute, with contents). */
  map?: { sources: string[]; sourcesContent?: string[]; mappings: string; [k: string]: unknown };
}

/** Bundle a model for bun into a temp `.mjs` (inline source map pointing at the TSX). */
export async function bundleModel(file: string): Promise<BunBundle> {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new Error(`no such file: ${file}`);
  const result = await Bun.build({
    entrypoints: [abs],
    target: "bun",
    format: "esm",
    sourcemap: "external",
    jsx: { runtime: "automatic", importSource: "tscad", development: false } as any,
    plugins: [runtimePlugin()],
    throw: false,
  });
  if (!result.success) throw new BundleError(`Failed to bundle ${relative(process.cwd(), abs) || abs}`, result.logs);
  let js = "", raw = "";
  for (const o of result.outputs) {
    if (o.kind === "sourcemap") raw = await o.text();
    else if (o.kind === "entry-point") js = await o.text();
  }
  let map: BunBundle["map"];
  if (raw) {
    map = JSON.parse(raw);
    map!.sources = map!.sources.map((s) => resolve(process.cwd(), s));
    js = js.replace(/\n\/\/# sourceMappingURL=.*$/m, "") + `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}\n`;
  }
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${basename(abs).replace(/\.[^.]+$/, "")}-${generation++}.mjs`);
  writeFileSync(path, js);
  return { path, map };
}

/** A model rendered and evaluated in-process, with timings. */
export interface ModelRun {
  rendered: RenderResult;
  result: EvalResult;
  kernel: KernelHost;
  timings: { import: number; render: number; kernel: number };
}

/** The parallel kernel when it pays off: native kernel, ≥ 2 parts, `TSCAD_PARALLEL` not "0". */
async function useParallel(base: KernelHost, parts: number): Promise<KernelHost | undefined> {
  if (parts < 2 || process.env.TSCAD_PARALLEL === "0" || base instanceof WasmKernelHost) return undefined;
  const { createParallelKernel } = await import("./parallel");
  return createParallelKernel();
}

/** Bundle, render and evaluate a model file with param overrides (the CLI's build/info/render/plate path). */
export async function runModel(file: string, overrides: Record<string, unknown>, opts: { tolerance?: number; noMesh?: boolean; /** Spread ≥ 2 parts over kernel processes (default true). */ parallel?: boolean } = {}): Promise<ModelRun> {
  const t0 = performance.now();
  const [mod, kernel] = await Promise.all([importModel(file), loadKernel()]);
  const t1 = performance.now();
  const rendered = renderModule(mod, overrides);
  const t2 = performance.now();
  const options: { tolerance?: number; noMesh?: boolean } = {};
  if (opts.tolerance !== undefined) options.tolerance = opts.tolerance;
  if (opts.noMesh) options.noMesh = true;
  // Two or more parts with the native kernel: spread them over kernel processes.
  const k = (opts.parallel !== false ? await useParallel(kernel, rendered.document.parts?.length ?? 0) : undefined) ?? kernel;
  const result = await k.evaluate(rendered.document, options);
  const t3 = performance.now();
  return { rendered, result, kernel: k, timings: { import: t1 - t0, render: t2 - t1, kernel: t3 - t2 } };
}

/** A kernel part error with the TSX location and a code frame. */
export function describePartError(p: PartResult, sourceMap: Record<string, { file: string; line: number; column: number; tag?: string }>): string {
  const e = p.error!;
  let path = e.path;
  let loc: { file: string; line: number; column: number; tag?: string } | undefined;
  while (path && !(loc = sourceMap[path])) {
    const i = path.lastIndexOf("/");
    if (i < 0) break;
    path = path.slice(0, i);
  }
  const head = `${c.red(c.bold(`${e.op} failed`))} in part ${c.bold(p.name)}: ${e.message}`;
  if (!loc) return `${head}\n  ${c.gray(`at node ${e.path}`)}`;
  return `${head}\n  ${c.gray("at")} ${c.cyan(`${rel(loc.file)}:${loc.line}:${loc.column}`)}${loc.tag ? c.gray(` <${loc.tag}>`) : ""} ${c.gray(`(node ${e.path})`)}\n${frameFor(loc)}`;
}

/** Describe a thrown error (TscadError carries `loc`; others get the first user frame). */
export function describeError(err: unknown, file: string): string {
  const e = err as any;
  const msg = typeof e?.detail === "string" ? e.detail : String(e?.message ?? err);
  let out = `${c.red(c.bold(e?.name && e.name !== "Error" ? e.name : "Error"))}: ${msg}`;
  if (e?.hint) out += `\n  ${c.yellow("hint:")} ${e.hint}`;
  let loc = e?.loc as { file: string; line: number; column: number } | undefined;
  if (!loc && typeof e?.stack === "string") {
    const abs = resolve(file);
    const m = e.stack.split("\n").map((l: string) => l.match(/\(?(\/[^\s()]+?):(\d+):(\d+)\)?$/)).find((m: RegExpMatchArray | null) => m && !m[1]!.startsWith(PKG_ROOT + "/src") && !m[1]!.startsWith(PKG_ROOT + "/wasm") && (m[1] === abs || !m[1]!.includes("node_modules")));
    if (m) loc = { file: m[1]!, line: Number(m[2]), column: Number(m[3]) };
  }
  if (loc) out += `\n  ${c.gray("at")} ${c.cyan(`${rel(loc.file)}:${loc.line}:${loc.column}`)}\n${frameFor(loc)}`;
  return out;
}

function frameFor(loc: { file: string; line: number; column: number }): string {
  try {
    return codeFrame(readFileSync(loc.file, "utf8"), loc.line, loc.column || 1)
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
  } catch {
    return "";
  }
}

export const rel = (f: string) => {
  const r = relative(process.cwd(), f);
  return r.startsWith("..") ? f : r;
};
