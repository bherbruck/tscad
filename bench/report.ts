/**
 * Regenerate the generated parts of docs/PERF.md from bench/results.json (latest run, plus
 * a trend of earlier runs) and bench/profile/*.json. Hand-written analysis lives after the
 * `<!-- analysis -->` marker and is kept.
 *   bun bench/report.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { table, type Run } from "./run";

const here = import.meta.dir;
const docPath = join(here, "..", "docs", "PERF.md");
const MARK = "<!-- analysis: hand-written, kept by bench/report.ts -->";

const L: string[] = [];
L.push("# Kernel performance", "");
L.push("Measured with tscad's bench (`bench/`). These are timings of real models and synthetic workloads on solidcore at rev `e7627f7f…`, natively (bun:ffi) and as wasm, plus a native kernel profile (solidcore's `profile` feature) per workload.", "");
L.push("```sh", "bun bench/dump-ir.ts                 # examples + variants + synthetic workloads → bench/ir/*.json", "bun bench/run.ts --repeat 3          # cold/warm timings, native and wasm → bench/results.json (appended)", "cargo test --release -p tscad-wasm --features profile,solidcore-ops/profile \\", "    --test perf_profile -- --nocapture --test-threads 1   # → bench/profile/*.json", "bun bench/report.ts                  # → this file (tables above the analysis)", "```", "");
L.push("**Cold** means a fresh kernel session evaluates the document: build, measure (volume and area), record, and display mesh. **Warm** means the same document evaluated again, with every subtree from tscad's cache. The figures are the best of N runs.", "");

if (existsSync(join(here, "results.json"))) {
  const { runs } = JSON.parse(readFileSync(join(here, "results.json"), "utf8")) as { runs: Run[] };
  const last = runs[runs.length - 1]!;
  L.push(`## Timings: ${last.date.slice(0, 16).replace("T", " ")} UTC, ${last.machine}, tscad ${last.version}, best of ${last.repeat}`, "");
  L.push(table(last), "");
  if (runs.length > 1) {
    L.push("### Trend (native cold, ms)", "");
    const recent = runs.slice(-6);
    const names = Object.keys(last.results).sort();
    L.push(`| Workload | ${recent.map((r) => r.date.slice(5, 16).replace("T", " ")).join(" | ")} |`, `|---|${recent.map(() => "---").join("|")}|`);
    for (const n of names) L.push(`| ${n} | ${recent.map((r) => (r.results[n]?.native ? r.results[n]!.native!.cold.toFixed(0) : "–")).join(" | ")} |`);
    L.push("");
  }
}

const profDir = join(here, "profile");
if (existsSync(profDir)) {
  const reports = readdirSync(profDir)
    .filter((f) => f.endsWith(".json") && f !== "summary.json")
    .map((f) => JSON.parse(readFileSync(join(profDir, f), "utf8")))
    .sort((a, b) => b.wall_ms - a.wall_ms);
  // totals over every workload
  const tot = new Map<string, { self: number; total: number; count: number }>();
  let wall = 0;
  for (const r of reports) {
    wall += r.kernel_ms;
    for (const s of r.scopes) {
      const t = tot.get(s.name) ?? { self: 0, total: 0, count: 0 };
      t.self += s.self_ms;
      t.total += s.total_ms;
      t.count += s.count;
      tot.set(s.name, t);
    }
  }
  L.push("## Kernel profile: where the time goes", "");
  L.push(`These totals cover all ${reports.length} profiled workloads, ${(wall / 1000).toFixed(1)} s of kernel time (native, release). *Self* is time in the scope itself, excluding its child scopes. Time inside ops calls that falls outside every kernel scope is in neither table.`, "");
  L.push("| Kernel scope | Calls | Self | Share of kernel time | Total (incl. children) |", "|---|---|---|---|---|");
  for (const [n, t] of [...tot.entries()].sort((a, b) => b[1].self - a[1].self).slice(0, 15))
    L.push(`| \`${n}\` | ${t.count} | ${(t.self / 1000).toFixed(2)} s | ${((100 * t.self) / wall).toFixed(1)}% | ${(t.total / 1000).toFixed(2)} s |`);
  const opsTot = new Map<string, { count: number; ms: number }>();
  for (const r of reports) for (const o of r.ops) {
    const t = opsTot.get(o.call) ?? { count: 0, ms: 0 };
    t.count += o.count;
    t.ms += o.total_ms;
    opsTot.set(o.call, t);
  }
  L.push("", "### By ops call", "", "The same kernel time, split by the `solidcore_ops` call that spent it (the kernel scopes above happen inside these):", "");
  L.push("| Ops call | Calls | Time | Share |", "|---|---|---|---|");
  for (const [n, t] of [...opsTot.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12)) L.push(`| \`${n}\` | ${t.count} | ${(t.ms / 1000).toFixed(2)} s | ${((100 * t.ms) / wall).toFixed(1)}% |`);
  L.push("", "### Per workload", "");
  L.push("| Workload | Wall | In ops calls | Top ops calls (count, time) | Top kernel scopes by self time |", "|---|---|---|---|---|");
  for (const r of reports) {
    const ops = r.ops.slice(0, 3).map((o: any) => `${o.call} ×${o.count} ${o.total_ms.toFixed(0)} ms`).join("; ");
    const sc = r.scopes.slice(0, 3).map((s: any) => `\`${s.name}\` ×${s.count} ${s.self_ms.toFixed(0)} ms`).join("; ");
    const err = r.phases.find((p: any) => p.error)?.error;
    L.push(`| ${r.workload}${r.ok ? "" : ` ⚠️ (${err})`} | ${r.wall_ms.toFixed(0)} ms | ${r.kernel_ms.toFixed(0)} ms | ${ops} | ${sc} |`);
  }
  L.push("");
}

let analysis = "";
if (existsSync(docPath)) {
  const old = readFileSync(docPath, "utf8");
  const i = old.indexOf(MARK);
  if (i >= 0) analysis = old.slice(i);
}
writeFileSync(docPath, L.join("\n") + "\n" + (analysis || `${MARK}\n`));
console.log("wrote", docPath);
