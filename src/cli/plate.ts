/** `tscad plate model.tsx -o plate.3mf`: print-ready plates (oriented, packed, several if needed). */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { toSTL } from "../export/stl";
import type { ExportPart } from "../export/mesh";
import { orientationNote, plate3MF, plateParts, transformMesh, type PlateResult } from "../plate";
import { describeError, describePartError, rel, runModel } from "./model";
import { c, fmtBytes, fmtMs, fmtNum, sym, table } from "./ui";

export interface PlateCliOptions {
  file: string;
  out?: string;
  params: Record<string, unknown>;
  bed?: string;
  spacing?: number;
  copies?: string[];
  orient?: string;
  tolerance?: number;
  json?: boolean;
}

/** `256x256` / `256` → [256, 256]. */
export function parseBed(s: string | undefined): [number, number] {
  if (!s) return [256, 256];
  const m = s.trim().match(/^(\d+(?:\.\d+)?)(?:\s*[x×*,]\s*(\d+(?:\.\d+)?))?$/i);
  if (!m) throw new Error(`--bed expects WIDTHxDEPTH in mm (e.g. 256x256), got "${s}"`);
  return [Number(m[1]), Number(m[2] ?? m[1])];
}

/** `["bolt=4", "nut=4,washer=2"]` → { bolt: 4, nut: 4, washer: 2 }. */
export function parseCopies(list: string[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of list ?? [])
    for (const pair of item.split(",")) {
      const m = pair.trim().match(/^(.+?)=(\d+)$/);
      if (!m) throw new Error(`--copies expects part=count, got "${pair}"`);
      out[m[1]!] = Number(m[2]);
    }
  return out;
}

/** Returns the exit code. */
export async function plate(opts: PlateCliOptions): Promise<number> {
  const t0 = performance.now();
  let bed: [number, number], copies: Record<string, number>;
  try {
    bed = parseBed(opts.bed);
    copies = parseCopies(opts.copies);
    if (opts.orient && !["auto", "keep"].includes(opts.orient)) throw new Error(`--orient is auto or keep, got "${opts.orient}"`);
  } catch (e) {
    console.error(`${sym.err} ${(e as Error).message}`);
    return 2;
  }
  const out = resolve(opts.out ?? `${basename(opts.file).replace(/\.[jt]sx?$/, "")}-plate.3mf`);
  const ext = extname(out).toLowerCase();
  if (ext !== ".3mf" && ext !== ".stl") {
    console.error(`${sym.err} plates are written as .3mf (with names, colours, notes) or .stl, not ${ext || "no extension"}`);
    return 2;
  }
  let run;
  try {
    run = await runModel(opts.file, opts.params);
  } catch (e) {
    console.error(describeError(e, opts.file));
    return 1;
  }
  const { rendered, result, kernel } = run;
  for (const p of result.parts.filter((p) => !p.ok)) console.error(`${sym.err} ${describePartError(p, rendered.sourceMap as any)}`);
  const unknown = Object.keys(copies).filter((n) => !result.parts.some((p) => p.name === n));
  if (unknown.length) {
    console.error(`${sym.err} --copies: no part named ${unknown.join(", ")} (parts: ${result.parts.map((p) => p.name).join(", ")})`);
    return 2;
  }
  const colors = new Map((rendered.document.parts ?? []).map((p) => [p.name ?? "", p.color]));
  const inputs = [];
  for (const p of result.parts) {
    if (!p.ok || p.empty) continue;
    inputs.push({ name: p.name, color: colors.get(p.name), mesh: await kernel.meshAt(p.name, opts.tolerance ?? 0.01), copies: copies[p.name] ?? 1 });
  }
  if (!inputs.length) {
    console.error(`${sym.err} nothing to put on a plate`);
    return 1;
  }
  const t1 = performance.now();
  let r: PlateResult;
  try {
    r = plateParts(inputs, { bed, spacing: opts.spacing ?? 5, orient: (opts.orient as "auto" | "keep") ?? "auto" });
  } catch (e) {
    console.error(`${sym.err} ${(e as Error).message}`);
    return 1;
  }
  const meshes = new Map(inputs.map((i) => [i.name, i.mesh]));
  const files: { path: string; bytes: number; plate: number }[] = [];
  for (let plateNo = 0; plateNo < r.plates; plateNo++) {
    const on = r.items.filter((it) => it.plate === plateNo);
    const parts: ExportPart[] = on.map((it) => ({ name: it.copy > 1 || (copies[it.name] ?? 1) > 1 ? `${it.name} #${it.copy}` : it.name, color: it.color, mesh: transformMesh(meshes.get(it.name)!, it.transform) }));
    const data = ext === ".3mf" ? plate3MF(parts, on.map(orientationNote), bed) : toSTL(parts, { binary: true });
    const path = r.plates === 1 ? out : out.replace(/(\.\w+)$/, `-${plateNo + 1}$1`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    files.push({ path, bytes: data.byteLength, plate: plateNo });
  }
  if (opts.json) {
    console.log(JSON.stringify({ bed, plates: r.plates, files: files.map((f) => f.path), items: r.items.map((it) => ({ name: it.name, copy: it.copy, plate: it.plate + 1, bottom: it.orientation.label, overhang: it.orientation.overhangFraction, overhangArea: it.orientation.overhangArea, height: it.orientation.height, rect: it.rect, rotated90: it.rotated90, transform: it.transform })) }, null, 2));
    return 0;
  }
  console.log();
  console.log(
    table(
      ["plate", "part", "bottom", "overhang", "height", "at (mm)"],
      r.items.map((it) => [
        String(it.plate + 1),
        c.bold(it.copy > 1 || (copies[it.name] ?? 1) > 1 ? `${it.name} #${it.copy}` : it.name),
        it.orientation.label,
        it.orientation.overhangArea < 1 ? c.green("none") : c.yellow(`${(it.orientation.overhangFraction * 100).toFixed(1)}%`),
        `${fmtNum(it.orientation.height, 1)}`,
        `${fmtNum(it.rect[0], 1)}, ${fmtNum(it.rect[1], 1)}${it.rotated90 ? c.gray(" ↻") : ""}`,
      ]),
      ["r", "l", "l", "r", "r", "l"],
    ),
  );
  console.log(c.gray(`\n  bed ${bed[0]} × ${bed[1]} mm · spacing ${opts.spacing ?? 5} mm · orient ${opts.orient ?? "auto"} · kernel ${fmtMs(run.timings.kernel)} · plating ${fmtMs(performance.now() - t1)}`));
  console.log();
  for (const f of files) console.log(`${sym.ok} ${c.bold(rel(f.path))} ${c.gray(`${fmtBytes(f.bytes)}${r.plates > 1 ? ` · plate ${f.plate + 1} of ${r.plates}` : ""}`)}`);
  console.log(c.gray(`\n  done in ${fmtMs(performance.now() - t0)}`));
  return 0;
}
