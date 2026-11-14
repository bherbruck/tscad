/** `tscad build` and `tscad info`. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve, basename } from "node:path";
import { exportModel, type ExportFormat } from "../export";
import type { PartResult } from "../ir";
import { describeError, describePartError, rel, runModel, type ModelRun } from "./model";
import { c, fmtBytes, fmtMs, fmtNum, fmtVolume, sym, table } from "./ui";

export const FORMATS: ExportFormat[] = ["step", "stl", "3mf", "glb", "obj"];
const EXT_ALIASES: Record<string, ExportFormat> = { stp: "step", step: "step", stl: "stl", "3mf": "3mf", glb: "glb", obj: "obj" };

export function formatOf(path: string, explicit?: string): ExportFormat {
  const f = (explicit ?? extname(path).slice(1)).toLowerCase();
  const fmt = EXT_ALIASES[f];
  if (!fmt) throw new Error(`unknown export format "${f || path}" (use ${FORMATS.map((x) => `.${x}`).join(", ")})`);
  return fmt;
}

export interface BuildOptions {
  file: string;
  outputs: string[];
  params: Record<string, unknown>;
  tolerance?: number;
  parts?: string[];
  format?: string;
  ascii?: boolean;
  quiet?: boolean;
  json?: boolean;
}

/** Returns the process exit code. */
export async function build(opts: BuildOptions): Promise<number> {
  const t0 = performance.now();
  const outputs = opts.outputs.length ? opts.outputs : [`${basename(opts.file).replace(/\.[jt]sx?$/, "")}.${opts.format ?? "stl"}`];
  let formats: ExportFormat[];
  try {
    formats = outputs.map((o) => formatOf(o, outputs.length === 1 ? opts.format : undefined));
  } catch (e) {
    console.error(`${sym.err} ${(e as Error).message}`);
    return 2;
  }
  const onlyStep = formats.every((f) => f === "step");
  let run: ModelRun;
  try {
    run = await runModel(opts.file, opts.params, { noMesh: onlyStep });
  } catch (e) {
    console.error(describeError(e, opts.file));
    return 1;
  }
  const { rendered, result } = run;
  for (const w of rendered.warnings) if (!opts.quiet) console.error(`${sym.warn} ${c.yellow(w)}`);

  let parts = result.parts;
  if (opts.parts?.length) {
    const missing = opts.parts.filter((n) => !parts.some((p) => p.name === n));
    if (missing.length) {
      console.error(`${sym.err} no part named ${missing.map((m) => c.bold(m)).join(", ")} (parts: ${parts.map((p) => p.name).join(", ")})`);
      return 2;
    }
    parts = parts.filter((p) => opts.parts!.includes(p.name));
  }
  if (!opts.quiet && !opts.json) printParts(parts, rendered.parts, run);

  const failed = parts.filter((p) => !p.ok);
  for (const p of failed) console.error(`\n${sym.err} ${describePartError(p, rendered.sourceMap as any)}`);
  if (failed.length) return 1;
  const good = parts.filter((p) => !p.empty);
  if (!good.length) {
    console.error(`${sym.err} nothing to export: every part is empty`);
    return 1;
  }

  const colors = new Map((rendered.document.parts ?? []).map((p) => [p.name ?? "", p.color]));
  const written: { path: string; bytes: number; ms: number }[] = [];
  for (let i = 0; i < outputs.length; i++) {
    const out = resolve(outputs[i]!);
    const t = performance.now();
    let data: Uint8Array | string;
    try {
      data = await exportModel(
        run.kernel,
        good.map((p) => ({ name: p.name, color: colors.get(p.name) })),
        formats[i]!,
        { tolerance: opts.tolerance, binary: !opts.ascii },
      );
    } catch (e) {
      console.error(`${sym.err} export to ${formats[i]} failed: ${(e as Error).message}`);
      return 1;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
    written.push({ path: out, bytes: typeof data === "string" ? Buffer.byteLength(data) : data.byteLength, ms: performance.now() - t });
  }
  if (opts.json) {
    console.log(JSON.stringify({ parts, outputs: written, params: rendered.values }, null, 2));
    return 0;
  }
  if (!opts.quiet) {
    console.log();
    for (const w of written) console.log(`${sym.ok} ${c.bold(rel(w.path))} ${c.gray(`${fmtBytes(w.bytes)} · ${fmtMs(w.ms)}`)}`);
    console.log(c.gray(`\n  done in ${fmtMs(performance.now() - t0)}`));
  }
  return 0;
}

function printParts(parts: PartResult[], infos: { name: string; density?: number; material?: string }[], run: ModelRun) {
  const anyMass = infos.some((i) => i.density !== undefined);
  const head = ["part", "volume", ...(anyMass ? ["mass"] : []), "size (mm)", "faces/edges", "time", ""];
  const rows = parts.map((p) => {
    const info = infos.find((i) => i.name === p.name);
    const size = p.bbox ? p.bbox[1].map((v, i) => fmtNum(v - p.bbox![0][i]!, 1)).join(" × ") : "—";
    const mass = info?.density !== undefined && p.volume !== undefined ? `${fmtNum((p.volume / 1000) * info.density)} g` : "—";
    const status = !p.ok ? c.red("failed") : p.empty ? c.yellow("empty") : p.cached ? c.yellow("⚡ cached") : c.green("ok");
    return [
      c.bold(p.name),
      fmtVolume(p.volume),
      ...(anyMass ? [mass] : []),
      size,
      p.counts ? `${p.counts[0]}/${p.counts[1]}` : "—",
      fmtMs(p.millis),
      status,
    ];
  });
  console.log();
  console.log(table(head, rows, ["l", "r", ...(anyMass ? (["r"] as const) : []), "r", "r", "r", "l"]));
  const t = run.timings;
  console.log(c.gray(`\n  import ${fmtMs(t.import)} · render ${fmtMs(t.render)} · kernel ${fmtMs(t.kernel)} · cache ${run.result.cacheHits} hit / ${run.result.cacheMisses} miss`));
}

/** `tscad info`: params and part stats. */
export async function info(opts: { file: string; params: Record<string, unknown>; json?: boolean }): Promise<number> {
  let run: ModelRun;
  try {
    run = await runModel(opts.file, opts.params);
  } catch (e) {
    console.error(describeError(e, opts.file));
    return 1;
  }
  const { rendered, result } = run;
  if (opts.json) {
    console.log(JSON.stringify({ params: rendered.params, values: rendered.values, parts: result.parts, info: rendered.parts, warnings: rendered.warnings }, null, 2));
    return result.ok ? 0 : 1;
  }
  console.log(`\n${c.bold(relative(process.cwd(), resolve(opts.file)))}`);
  const schema = rendered.params as Record<string, any>;
  const keys = Object.keys(schema);
  console.log(`\n${c.accent("Parameters")}${keys.length ? "" : c.gray("  (none)")}`);
  if (keys.length) {
    const rows = keys.map((k) => {
      const s = schema[k];
      const range = s.options ? s.options.map((o: any) => (typeof o === "object" ? o.value : o)).join(" | ") : s.min !== undefined || s.max !== undefined ? `${s.min ?? "−∞"} … ${s.max ?? "∞"}${s.step ? ` step ${s.step}` : ""}` : "";
      const v = (rendered.values as any)[k];
      const changed = v !== s.default;
      return [c.bold(k), c.gray(s.type), JSON.stringify(s.default), changed ? c.yellow(JSON.stringify(v)) : c.gray(JSON.stringify(v)), range, s.unit ?? "", s.label ?? ""];
    });
    console.log(table(["name", "type", "default", "value", "range", "unit", "label"], rows));
  }
  console.log(`\n${c.accent("Parts")}`);
  printParts(result.parts, rendered.parts, run);
  for (const p of result.parts.filter((p) => !p.ok)) console.error(`\n${sym.err} ${describePartError(p, rendered.sourceMap as any)}`);
  for (const w of rendered.warnings) console.error(`${sym.warn} ${c.yellow(w)}`);
  console.log();
  return result.ok ? 0 : 1;
}
