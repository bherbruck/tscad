/** `tscad build` and `tscad info`. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve, basename } from "node:path";
import { exportModel, type ExportFormat as MeshFormat } from "../export";
import { section, polylineLoops, toDXF, toSVG } from "../drawing";
import type { PartResult } from "../ir";
import { describeError, describePartError, rel, runModel, type ModelRun } from "./model";
import { c, fmtBytes, fmtMs, fmtNum, fmtVolume, sym, table } from "./ui";
import { drawingMeta } from "../viewer/fmt";

/** What `tscad build -o` can write. */
export type ExportFormat = MeshFormat | "dxf" | "svg";
export const FORMATS: ExportFormat[] = ["step", "stl", "3mf", "glb", "obj", "dxf", "svg"];
const EXT_ALIASES: Record<string, ExportFormat> = { stp: "step", step: "step", stl: "stl", "3mf": "3mf", glb: "glb", obj: "obj", dxf: "dxf", svg: "svg" };
const is2D = (f: ExportFormat): f is "dxf" | "svg" => f === "dxf" || f === "svg";

/** The output format: `--format`, else the file extension; throws for unknown ones. */
export function formatOf(path: string, explicit?: string): ExportFormat {
  const f = (explicit ?? extname(path).slice(1)).toLowerCase();
  const fmt = EXT_ALIASES[f];
  if (!fmt) throw new Error(`unknown export format "${f || path}" (use ${FORMATS.map((x) => `.${x}`).join(", ")})`);
  return fmt;
}

/** Options of `tscad build`. */
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
  /** DXF/SVG of a model without `<drawing>`s: slice the parts at this Z (default: mid-height). */
  sectionZ?: number;
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
  const onlyStep = formats.every((f) => f === "step" || is2D(f));
  let run: ModelRun;
  try {
    // STEP needs every part in one kernel session, so it gains nothing from kernel processes.
    run = await runModel(opts.file, opts.params, { noMesh: onlyStep, parallel: !formats.includes("step") });
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
  const drawings = (rendered.drawings ?? []).filter((d) => !opts.parts?.length || opts.parts.includes(d.name));
  const onlyDrawings = formats.every(is2D) && drawings.length > 0;
  if (!opts.quiet && !opts.json && parts.length) printParts(parts, rendered.parts, run);
  if (!opts.quiet && !opts.json && drawings.length) console.log(`\n  ${c.bold("drawings")} ${drawings.map((d) => `${d.name} ${c.gray(`(${drawingMeta({ loops: d.loops.length, paths: d.paths?.length, notes: d.notes }).replace(/^drawing · /, "")})`)}`).join(", ")}`);

  const failed = parts.filter((p) => !p.ok);
  for (const p of failed) console.error(`\n${sym.err} ${describePartError(p, rendered.sourceMap as any)}`);
  if (failed.length) return 1;
  const good = parts.filter((p) => !p.empty);
  if (!good.length && !onlyDrawings) {
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
      const fmt = formats[i]!;
      if (is2D(fmt)) {
        const layers = drawings.length ? drawings : await sectionLayers(run, good, opts.sectionZ, opts.tolerance);
        if (!layers.some((l: { loops: unknown[]; paths?: unknown[]; notes?: unknown[] }) => l.loops.length || l.paths?.length || l.notes?.length)) throw new Error(drawings.length ? "the drawings are empty" : `the section at z = ${fmtNum(sectionZOf(good, opts.sectionZ))} cuts nothing (try --section-z)`);
        data = fmt === "dxf" ? toDXF(layers) : toSVG(layers);
      } else {
        if (!good.length) throw new Error("no solid parts (this model only has drawings: export .dxf or .svg)");
        data = await exportModel(run.kernel, good.map((p) => ({ name: p.name, color: colors.get(p.name) })), fmt, { tolerance: opts.tolerance, binary: !opts.ascii });
      }
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
    const size = p.bbox ? p.bbox[1].map((v, i) => fmtNum(v - p.bbox![0][i]!, 1)).join(" × ") : "-";
    const mass = info?.density !== undefined && p.volume !== undefined ? `${fmtNum((p.volume / 1000) * info.density)} g` : "-";
    const status = !p.ok ? c.red("failed") : p.empty ? c.yellow("empty") : p.cached ? c.yellow("⚡ cached") : c.green("ok");
    return [
      c.bold(p.name),
      fmtVolume(p.volume),
      ...(anyMass ? [mass] : []),
      size,
      p.counts ? `${p.counts[0]}/${p.counts[1]}` : "-",
      fmtMs(p.millis),
      status,
    ];
  });
  console.log();
  console.log(table(head, rows, ["l", "r", ...(anyMass ? (["r"] as const) : []), "r", "r", "r", "l"]));
  const t = run.timings;
  console.log(c.gray(`\n  import ${fmtMs(t.import)} · render ${fmtMs(t.render)} · kernel ${fmtMs(t.kernel)} (${kernelKind(run.kernel)}) · cache ${run.result.cacheHits}/${run.result.cacheHits + run.result.cacheMisses}`));
}

/** "native", "native ×3" (kernel processes) or "wasm" (no native library for this platform). */
function kernelKind(k: unknown): string {
  const any = k as any;
  if (any?.constructor?.name === "WasmKernelHost") return "wasm";
  if (any?.pool?.size > 1) return `native ×${any.pool.size}`;
  return "native";
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
  console.log(`\n${c.bold(rel(resolve(opts.file)))}`);
  const schema = rendered.params as Record<string, any>;
  const keys = Object.keys(schema);
  console.log(`\n${c.accent("Parameters")}${keys.length ? "" : c.gray("  (none)")}`);
  if (keys.length) {
    const rows = keys.map((k) => {
      const s = schema[k];
      const unit = s.unit ? ` ${s.unit}` : "";
      const range = s.options
        ? s.options.map((o: any) => (typeof o === "object" ? o.value : o)).join("|")
        : s.min !== undefined || s.max !== undefined
          ? `${s.min ?? "−∞"}–${s.max ?? "∞"}${unit}${s.step && s.step !== 1 ? ` /${s.step}` : ""}`
          : "";
      const v = (rendered.values as any)[k];
      const show = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));
      // One value column: the default, or "default → value" when overridden with -p.
      const value = v !== s.default ? `${c.gray(show(s.default))} → ${c.yellow(show(v))}` : `${show(v)}${typeof v === "number" ? unit : ""}`;
      return [c.bold(k), c.gray(s.type), value, c.gray(range), s.label && s.label !== k ? s.label : ""];
    });
    console.log(table(["name", "type", "value", "range", "label"], rows));
  }
  console.log(`\n${c.accent("Parts")}`);
  printParts(result.parts, rendered.parts, run);
  for (const p of result.parts.filter((p) => !p.ok)) console.error(`\n${sym.err} ${describePartError(p, rendered.sourceMap as any)}`);
  for (const w of rendered.warnings) console.error(`${sym.warn} ${c.yellow(w)}`);
  console.log();
  return result.ok ? 0 : 1;
}

/** Z of the default section: the middle of the parts' combined height. */
function sectionZOf(parts: PartResult[], z?: number): number {
  if (z !== undefined) return z;
  const lo = Math.min(...parts.map((p) => p.bbox?.[0][2] ?? 0)), hi = Math.max(...parts.map((p) => p.bbox?.[1][2] ?? 0));
  return (lo + hi) / 2;
}

/** One layer per part: its outline cut by the plane z = `sectionZ`. */
async function sectionLayers(run: ModelRun, parts: PartResult[], sectionZ: number | undefined, tolerance = 0.01) {
  const z = sectionZOf(parts, sectionZ);
  const out = [];
  for (const p of parts) {
    const mesh = await run.kernel.meshAt(p.name, tolerance);
    out.push({ name: p.name, loops: polylineLoops(section(mesh, { origin: [0, 0, z], normal: [0, 0, 1] }).loops) });
  }
  return out;
}
