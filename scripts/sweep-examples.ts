#!/usr/bin/env bun
/**
 * Param-space robustness sweep: every example is evaluated across its params (the defaults, a
 * seeded latin hypercube and the min/max corners, from `paramCombos`) with the kernel (native when
 * built), and each failing combo is reported.
 *
 *   bun scripts/sweep-examples.ts [name...] [--samples 24] [--seed 1] [--jobs 8] [--md docs/SWEEP.md] [--json out.json]
 *
 * Every example runs in its own bun process; a combo that makes no progress for --stall seconds
 * (default 60) is recorded as a hang and the process restarts at the next combo. A combo slower
 * than --slow seconds (default 15) is recorded as slow.
 */
import { readdirSync, writeSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = join(import.meta.dir, "..");

/** The example files the sweep covers: examples/*.tsx and one level of sub-folders. */
export function exampleFiles(): string[] {
  const out: string[] = [];
  const skip = (f: string) => f.startsWith("_") || /\.(spec|test)\.tsx$/.test(f);
  for (const e of readdirSync(join(root, "examples"), { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".tsx") && !skip(e.name)) out.push(join(root, "examples", e.name));
    if (e.isDirectory() && e.name !== "tests" && e.name !== "assets") {
      for (const f of readdirSync(join(root, "examples", e.name))) if (f.endsWith(".tsx") && !skip(f)) out.push(join(root, "examples", e.name, f));
    }
  }
  return out.sort();
}

/** What one combo gave. */
export interface ComboResult {
  i: number;
  params: Record<string, unknown>;
  status: "ok" | "compile" | "kernel" | "panic" | "empty" | "hang";
  message?: string;
  part?: string;
  ms: number;
}

export interface ExampleResult {
  file: string;
  combos: ComboResult[];
  /** Import or setup failure (nothing swept). */
  error?: string;
}

export interface SweepOptions {
  samples?: number;
  seed?: number;
  /** Max combos per example. */
  max?: number;
}

/** The combos swept for a params schema. */
export async function sweepCombos(schema: Record<string, any>, o: SweepOptions = {}): Promise<Record<string, unknown>[]> {
  const { paramCombos } = await import("../src/testing/params");
  const discrete = Object.values(schema).reduce((n: number, s: any) => n * (s.type === "boolean" ? 2 : s.type === "choice" ? s.options.length : 1), 1);
  const samples = Math.max(2, Math.ceil((o.samples ?? 24) / discrete));
  const max = o.max ?? 36;
  const lhs = paramCombos(schema as any, { samples, seed: o.seed ?? 1, max: max - 8 }) as Record<string, unknown>[];
  const corners = paramCombos(schema as any, { method: "corners", defaults: false, max: 8 }) as Record<string, unknown>[];
  const seen = new Set<string>();
  return [...lhs, ...corners].filter((c) => {
    const k = JSON.stringify(c);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

// ---------------------------------------------------------------------------------------------
// worker: one example, combos from --start on, one JSON line per combo

/** One line to the parent, unbuffered (a hung combo must not hold back its own `begin`). */
const emit = (m: unknown) => writeSync(1, JSON.stringify(m) + "\n");

async function worker(file: string, start: number, o: SweepOptions) {
  const { renderModule } = await import("../src/index");
  const { loadKernel, KernelPanic } = await import("../src/kernel");
  const mod = await import(file);
  const combos = await sweepCombos(mod.params ?? {}, o);
  emit({ total: combos.length });
  let kernel = await loadKernel();
  for (let i = start; i < combos.length; i++) {
    const params = combos[i]!;
    emit({ begin: i, params });
    const t0 = performance.now();
    const r: ComboResult = { i, params, status: "ok", ms: 0 };
    try {
      const { document } = renderModule(mod, params);
      await kernel.clearCache();
      const res = await kernel.evaluate(document);
      const bad = res.parts.find((p) => !p.ok);
      const empty = res.parts.find((p) => p.ok && (p.empty || !(p.volume! > 0)) && !(document.parts ?? []).find((d: any) => d.name === p.name && d.drawing));
      if (bad) Object.assign(r, { status: "kernel", part: bad.name, message: `${bad.error?.op ?? ""}: ${bad.error?.message ?? "failed"}` });
      else if (empty) Object.assign(r, { status: "empty", part: empty.name, message: "part evaluated to nothing" });
    } catch (e) {
      if (e instanceof KernelPanic) {
        Object.assign(r, { status: "panic", message: e.message });
        kernel = await loadKernel();
      } else Object.assign(r, { status: "compile", message: e instanceof Error ? e.message : String(e) });
    }
    r.ms = Math.round(performance.now() - t0);
    if (r.message) r.message = r.message.split("\n")[0]!.slice(0, 240);
    emit({ done: r });
  }
}

// ---------------------------------------------------------------------------------------------
// parent

/** Sweep one example in child processes (restarting past hangs). */
export async function sweepExample(file: string, o: SweepOptions & { stallMs?: number } = {}): Promise<ExampleResult> {
  const out: ExampleResult = { file, combos: [] };
  let start = 0;
  let total = Infinity;
  while (start < total) {
    const args = ["bun", import.meta.path, "--worker", file, "--start", String(start), "--samples", String(o.samples ?? 24), "--seed", String(o.seed ?? 1), "--max", String(o.max ?? 36)];
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", cwd: root });
    let current = -1;
    let currentParams: Record<string, unknown> = {};
    let beganAt = performance.now();
    let timedOut = false;
    const timer = setInterval(() => {
      if (performance.now() - beganAt > (o.stallMs ?? 60_000) + (current < 0 ? 60_000 : 0)) {
        timedOut = true;
        proc.kill(9);
      }
    }, 1000);
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.total !== undefined) total = m.total;
        if (m.begin !== undefined) (current = m.begin), (currentParams = m.params), (beganAt = performance.now());
        if (m.done) (out.combos.push(m.done), (current = -1), (start = m.done.i + 1));
      }
    }
    await proc.exited;
    clearInterval(timer);
    if (current >= 0) {
      // died (hang killed, or crashed) inside combo `current`
      const err = timedOut ? "" : (await new Response(proc.stderr).text()).trim().split("\n").slice(-1)[0] ?? "";
      out.combos.push({ i: current, params: currentParams, status: timedOut ? "hang" : "panic", message: timedOut ? `no result after ${((o.stallMs ?? 60_000) / 1000).toFixed(0)} s` : `process died: ${err}`, ms: Math.round(performance.now() - beganAt) });
      start = current + 1;
      continue;
    }
    if (total === Infinity) {
      out.error = (await new Response(proc.stderr).text()).trim().split("\n").slice(-3).join(" ").slice(0, 300) || `exit ${proc.exitCode}`;
      break;
    }
    if (start < total) {
      // exited early without a begin: give up rather than loop
      out.error = `worker exited at combo ${start}/${total}`;
      break;
    }
  }
  return out;
}

/** Sweep many examples, `jobs` at a time. */
export async function sweep(files: string[], o: SweepOptions & { jobs?: number; stallMs?: number; onDone?: (r: ExampleResult) => void } = {}): Promise<ExampleResult[]> {
  const results: ExampleResult[] = new Array(files.length);
  let next = 0;
  const lane = async () => {
    while (next < files.length) {
      const k = next++;
      results[k] = await sweepExample(files[k]!, o);
      o.onDone?.(results[k]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.jobs ?? 8) }, lane));
  return results;
}

const passed = (r: ExampleResult) => r.combos.filter((c) => c.status === "ok").length;
const label = (file: string) => relative(join(root, "examples"), file).replace(/\.tsx$/, "");

/** A markdown report. */
export function report(results: ExampleResult[], slowMs = 15_000): string {
  const lines = ["| example | pass | failures | slowest |", "| --- | --- | --- | --- |"];
  for (const r of results) {
    const fails = r.combos.filter((c) => c.status !== "ok");
    const kinds = [...new Set(fails.map((c) => c.status))].join(", ");
    const slow = Math.max(0, ...r.combos.map((c) => c.ms));
    lines.push(`| ${label(r.file)} | ${r.error ? "—" : `${passed(r)}/${r.combos.length}`} | ${r.error ? `import: ${r.error}` : kinds || "—"} | ${(slow / 1000).toFixed(1)} s${slow > slowMs ? " ⚠" : ""} |`);
  }
  const detail: string[] = [];
  for (const r of results) {
    const fails = r.combos.filter((c) => c.status !== "ok");
    if (!fails.length) continue;
    detail.push(`\n### ${label(r.file)}\n`);
    for (const c of fails.slice(0, 8)) detail.push(`- **${c.status}**${c.part ? ` (${c.part})` : ""}: ${c.message ?? ""} — \`${JSON.stringify(c.params)}\``);
    if (fails.length > 8) detail.push(`- … ${fails.length - 8} more`);
  }
  return [lines.join("\n"), ...detail].join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string, def?: string) => {
    const i = args.indexOf(name);
    if (i < 0) return def;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const o: SweepOptions = { samples: Number(flag("--samples", "24")), seed: Number(flag("--seed", "1")), max: Number(flag("--max", "36")) };
  const workerFile = flag("--worker");
  if (workerFile) {
    await worker(workerFile, Number(flag("--start", "0")), o);
    process.exit(0);
  }
  const jobs = Number(flag("--jobs", "8"));
  const md = flag("--md");
  const json = flag("--json");
  const stallMs = Number(flag("--stall", "60")) * 1000;
  const slowMs = Number(flag("--slow", "15")) * 1000;
  const names = args.filter((a) => !a.startsWith("--"));
  const files = exampleFiles().filter((f) => !names.length || names.some((n) => label(f) === n || basename(f, ".tsx") === n));
  const t0 = performance.now();
  const results = await sweep(files, {
    ...o,
    jobs,
    stallMs,
    onDone: (r) => {
      const fails = r.combos.filter((c) => c.status !== "ok");
      const slow = Math.max(0, ...r.combos.map((c) => c.ms));
      console.log(`${r.error ? "✗" : fails.length ? "!" : "✓"} ${label(r.file)}: ${r.error ?? `${passed(r)}/${r.combos.length}`}${fails.length ? ` (${[...new Set(fails.map((c) => c.status))].join(", ")})` : ""}${slow > slowMs ? ` slow ${(slow / 1000).toFixed(1)} s` : ""}`);
    },
  });
  const total = results.reduce((n, r) => n + r.combos.length, 0);
  const ok = results.reduce((n, r) => n + passed(r), 0);
  console.log(`\n${ok}/${total} combos pass across ${results.length} examples in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  if (json) await Bun.write(json, JSON.stringify(results, null, 1));
  if (md) await Bun.write(md, report(results, slowMs));
  process.exit(results.every((r) => !r.error && passed(r) === r.combos.length) ? 0 : 1);
}
