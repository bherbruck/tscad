/** `tscad render`: a PNG of the model via the headless renderer (src/render). */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { renderPNG, type RenderPart, type View } from "../render";
import { describeError, describePartError, rel, runModel } from "./model";
import { c, fmtBytes, fmtMs, sym } from "./ui";

export interface RenderCliOptions {
  file: string;
  out?: string;
  params: Record<string, unknown>;
  view?: string;
  width?: number;
  height?: number;
  background?: string;
  ortho?: boolean;
  edges?: boolean;
  /** Print `{ out, parts: [{ name, ok, volume }] }` on stdout (for the gallery). */
  json?: boolean;
}

const VIEWS = ["iso", "front", "back", "top", "bottom", "right", "left"];

export function parseView(v: string | undefined): View {
  if (!v) return "iso";
  if (VIEWS.includes(v)) return v as View;
  const m = v.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (m) return { azimuth: Number(m[1]), elevation: Number(m[2]) };
  throw new Error(`--view must be one of ${VIEWS.join(", ")} or <azimuth>,<elevation> (got "${v}")`);
}

/** Returns the exit code. */
export async function render(opts: RenderCliOptions): Promise<number> {
  const t0 = performance.now();
  let view: View;
  try {
    view = parseView(opts.view);
    for (const [k, v] of [["width", opts.width], ["height", opts.height]] as const) if (v !== undefined && !(v >= 16 && v <= 8192)) throw new Error(`--${k} must be 16..8192 px`);
  } catch (e) {
    console.error(`${sym.err} ${(e as Error).message}`);
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
  const failed = result.parts.filter((p) => !p.ok);
  for (const p of failed) console.error(`${sym.err} ${describePartError(p, rendered.sourceMap as any)}`);
  const colors = new Map((rendered.document.parts ?? []).map((p) => [p.name ?? "", p.color]));
  const parts: RenderPart[] = [];
  for (const p of result.parts) {
    if (!p.ok || p.empty) continue;
    const mesh = await kernel.mesh(p.name);
    if (mesh) parts.push({ name: p.name, color: colors.get(p.name), mesh });
  }
  const summary = () => JSON.stringify({ out: opts.out, parts: result.parts.map((p) => ({ name: p.name, ok: p.ok, volume: p.volume })) });
  if (!parts.length) {
    console.error(`${sym.err} nothing to render`);
    if (opts.json) console.log(summary());
    return 1;
  }
  const t1 = performance.now();
  const png = renderPNG(parts, {
    view,
    width: opts.width,
    height: opts.height,
    background: opts.background as any,
    projection: opts.ortho ? "orthographic" : "perspective",
    edges: opts.edges,
  });
  const out = resolve(opts.out ?? `${basename(opts.file).replace(/\.[jt]sx?$/, "")}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  if (opts.json) console.log(summary());
  (opts.json ? console.error : console.log)(`${sym.ok} ${c.bold(rel(out))} ${c.gray(`${fmtBytes(png.byteLength)} · kernel ${fmtMs(run.timings.kernel)} · render ${fmtMs(performance.now() - t1)} · total ${fmtMs(performance.now() - t0)}`)}`);
  return failed.length ? 1 : 0;
}
