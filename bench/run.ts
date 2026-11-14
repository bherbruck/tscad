/**
 * Kernel benchmark: every IR document in bench/ir/ (`bun bench/dump-ir.ts`), evaluated cold
 * (a fresh session) and warm (the same document again: every subtree from the cache) on the
 * native kernel and on wasm, best of N. Appends a run to bench/results.json, so regressions show
 * over time, and prints a markdown table (also used by `bun bench/report.ts` for docs/PERF.md).
 *
 *   bun bench/run.ts [--repeat 3] [--only name,name] [--no-wasm] [--no-native]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { join } from "node:path";
import type { Document, EvalResult } from "../src/ir";
import { createKernel, loadKernel, type KernelHost } from "../src/kernel";

const here = import.meta.dir;
const argv = process.argv.slice(2);
const opt = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const REPEAT = Number(opt("--repeat") ?? 3);
const ONLY = opt("--only")?.split(",");
const engines = (["native", "wasm"] as const).filter((e) => !argv.includes(`--no-${e}`));

export interface Timing {
  cold: number;
  warm: number;
  phases: { build: number; measure: number; record: number; mesh: number };
  ok: boolean;
  error?: string;
}
export interface Run {
  date: string;
  version: string;
  machine: string;
  repeat: number;
  results: Record<string, Partial<Record<"native" | "wasm", Timing>>>;
}

const wasmModule = await WebAssembly.compile(readFileSync(join(here, "..", "wasm", "tscad_wasm_bg.wasm")));
async function session(engine: "native" | "wasm"): Promise<KernelHost> {
  if (engine === "wasm") return loadKernel(wasmModule);
  const k = await createKernel();
  if (k.constructor.name.startsWith("Wasm")) throw new Error("native kernel not available (bun scripts/build-native.ts)");
  return k;
}

function phases(r: EvalResult) {
  const p = { build: 0, measure: 0, record: 0, mesh: 0 };
  for (const part of r.parts as any[]) for (const k of Object.keys(p) as (keyof typeof p)[]) p[k] += part.phases?.[k] ?? 0;
  return p;
}

async function time(engine: "native" | "wasm", doc: Document): Promise<Timing> {
  let best: Timing | undefined;
  for (let i = 0; i < REPEAT; i++) {
    const k = await session(engine);
    let t = performance.now();
    const r = await k.evaluate(doc);
    const cold = performance.now() - t;
    t = performance.now();
    await k.evaluate(doc);
    const warm = performance.now() - t;
    k.dispose?.();
    const err = r.parts.find((p) => !p.ok)?.error;
    const cur: Timing = { cold, warm, phases: phases(r), ok: r.ok, ...(err ? { error: `${err.op}: ${err.message}` } : {}) };
    if (!best || cur.cold < best.cold) best = { ...cur, warm: Math.min(cur.warm, best?.warm ?? Infinity) };
  }
  return best!;
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`);

/** A markdown table of one run. */
export function table(run: Run): string {
  const L = ["| Workload | Native cold | Native warm | Wasm cold | Wasm warm | Wasm ÷ native | Native build / measure / record / mesh |", "|---|---|---|---|---|---|---|"];
  const rows = Object.entries(run.results).sort((a, b) => (b[1].native?.cold ?? b[1].wasm?.cold ?? 0) - (a[1].native?.cold ?? a[1].wasm?.cold ?? 0));
  for (const [name, r] of rows) {
    const n = r.native, w = r.wasm;
    const ratio = n && w ? `${(w.cold / n.cold).toFixed(1)}×` : "–";
    const ph = n ? `${fmt(n.phases.build)} / ${fmt(n.phases.measure)} / ${fmt(n.phases.record)} / ${fmt(n.phases.mesh)}` : "–";
    const bad = (t?: Timing) => (t && !t.ok ? " ⚠️" : "");
    L.push(`| ${name}${bad(n) || bad(w)} | ${n ? fmt(n.cold) : "–"} | ${n ? fmt(n.warm) : "–"} | ${w ? fmt(w.cold) : "–"} | ${w ? fmt(w.warm) : "–"} | ${ratio} | ${ph} |`);
  }
  return L.join("\n");
}

if (import.meta.main) {
  const files = readdirSync(join(here, "ir")).filter((f) => f.endsWith(".json")).sort();
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  const run: Run = { date: new Date().toISOString(), version: pkg.version, machine: `${platform()}-${arch()} ${cpus()[0]?.model ?? ""}`.trim(), repeat: REPEAT, results: {} };
  for (const f of files) {
    const name = f.replace(/\.json$/, "");
    if (ONLY && !ONLY.includes(name)) continue;
    const doc = JSON.parse(readFileSync(join(here, "ir", f), "utf8")) as Document;
    run.results[name] = {};
    for (const e of engines) {
      try {
        run.results[name]![e] = await time(e, doc);
      } catch (err) {
        run.results[name]![e] = { cold: NaN, warm: NaN, phases: { build: 0, measure: 0, record: 0, mesh: 0 }, ok: false, error: String(err) };
      }
      const t = run.results[name]![e]!;
      console.log(`${name.padEnd(30)} ${e.padEnd(6)} cold ${fmt(t.cold).padStart(9)}  warm ${fmt(t.warm).padStart(7)}${t.ok ? "" : `  ⚠️ ${t.error}`}`);
    }
  }
  const path = join(here, "results.json");
  const history: { runs: Run[] } = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { runs: [] };
  history.runs.push(run);
  writeFileSync(path, JSON.stringify(history, null, 1));
  console.log("\n" + table(run));
}
