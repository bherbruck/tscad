/**
 * Render snapshot tests: render a model with the headless renderer (`tscad/render`, no GPU,
 * no browser) and compare it with a PNG kept next to the tests. A missing snapshot is written
 * (except under `CI`, where it fails); `TSCAD_UPDATE_SNAPSHOTS=1` rewrites them all. On a mismatch, `<name>.<view>.diff.png` shows
 * the differing pixels in red over a faded copy of the expected image.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePNG, encodePNG, renderImage, type Image, type RenderOptions, type RenderPart, type View } from "../render/index";
import { evaluateModel, ModelResult, type EvaluateOptions, type ModelInput } from "./model";

/** Options for {@link matchRenderSnapshot}. */
export interface RenderSnapshotOptions {
  /** Snapshot name: the file is `<dir>/<name>.<view>.png`. */
  name: string;
  /** Directory for the PNGs. Default `__snapshots__` in the current directory. */
  dir?: string;
  /** Camera view. Default `"iso"`. */
  view?: Exclude<View, object>;
  /** Image size in pixels. Default 256 × 192. */
  width?: number;
  height?: number;
  /** Largest per-channel difference (0–255) for a pixel to count as equal. Default 24. */
  tolerance?: number;
  /** Largest share of differing pixels that still passes. Default 0.005 (0.5 %). */
  maxDiffRatio?: number;
  /**
   * Round colour channels to multiples of this before saving and comparing: halves the PNG
   * size, invisible at a glance. Default 8; 1 keeps full precision.
   */
  quantize?: number;
  /** Rewrite the snapshot instead of comparing. Default: `TSCAD_UPDATE_SNAPSHOTS=1`. */
  update?: boolean;
  /** Params, when given a model module or component. */
  params?: Record<string, unknown>;
  /** Kernel and tolerance for evaluating it. */
  evaluate?: EvaluateOptions;
  /** More renderer options (background, edges...). */
  render?: Omit<RenderOptions, "width" | "height" | "view">;
}

/** What {@link matchRenderSnapshot} found. */
export interface RenderSnapshotResult {
  pass: boolean;
  /** The snapshot was missing (or `update` was set) and has been written. */
  written: boolean;
  /** The snapshot PNG. */
  path: string;
  /** The diff PNG, written when the images differ too much. */
  diffPath?: string;
  /** Pixels over `tolerance`, and their share of the image. */
  diffPixels: number;
  diffRatio: number;
  /** A one-line explanation. */
  message: string;
}

/** Pixel differences between two images of the same size. */
export interface ImageDiff {
  diffPixels: number;
  diffRatio: number;
  /** Largest channel difference seen (0–255). */
  maxDelta: number;
  /** RGBA: differing pixels red, the rest a faded copy of `expected`. */
  image: Image;
}

/** Compare two RGBA images pixel by pixel; a pixel differs when any channel is off by more than `tolerance`. */
export function diffImages(expected: Image, actual: Image, tolerance = 24): ImageDiff {
  if (expected.width !== actual.width || expected.height !== actual.height) throw new Error(`image sizes differ: ${expected.width}×${expected.height} vs ${actual.width}×${actual.height}`);
  const n = expected.width * expected.height;
  const out = new Uint8Array(n * 4);
  let diffPixels = 0, maxDelta = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(expected.data[o + c]! - actual.data[o + c]!));
    maxDelta = Math.max(maxDelta, d);
    if (d > tolerance) {
      diffPixels++;
      out.set([255, 32, 32, 255], o);
    } else {
      const g = (expected.data[o]! * 0.3 + expected.data[o + 1]! * 0.59 + expected.data[o + 2]! * 0.11) * 0.35 + 30;
      out.set([g, g, g, 255], o);
    }
  }
  return { diffPixels, diffRatio: diffPixels / n, maxDelta, image: { width: expected.width, height: expected.height, data: out } };
}

/** The parts of an evaluated model, ready for the renderer (failed and empty parts left out). */
export function renderParts(r: ModelResult): RenderPart[] {
  const colors = new Map((r.document.parts ?? []).map((p) => [p.name ?? "", p.color ?? undefined]));
  const parts: RenderPart[] = [];
  for (const [name, mesh] of r.meshes) parts.push({ name, color: colors.get(name), mesh });
  return parts;
}

const toRGB = (img: Image) => {
  const rgb = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) rgb.set(img.data.subarray(i * 4, i * 4 + 3), i * 3);
  return rgb;
};

/** `img` with its colour channels rounded to multiples of `step` (alpha kept). */
function quantized(img: Image, step: number): Image {
  if (step <= 1) return img;
  const data = new Uint8Array(img.data);
  for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = Math.min(255, Math.round(data[i]! / step) * step);
  return { ...img, data };
}

/**
 * Render a model (a module, component, element, or the result of `evaluateModel`) and compare
 * it with its snapshot. Writes the snapshot when missing. Never throws for a mismatch: check
 * `pass`, or use `await expect(model).toMatchRenderSnapshot("name")`.
 *
 * @example
 * import * as bracket from "./bracket"
 * const r = await matchRenderSnapshot(bracket, { name: "bracket", dir: "tests/__snapshots__" })
 * expect(r.pass, r.message).toBe(true)
 */
export async function matchRenderSnapshot(model: ModelInput | ModelResult, opts: RenderSnapshotOptions): Promise<RenderSnapshotResult> {
  const view = opts.view ?? "iso";
  const dir = resolve(opts.dir ?? "__snapshots__");
  const path = join(dir, `${opts.name}.${view}.png`);
  const diffPath = join(dir, `${opts.name}.${view}.diff.png`);
  const r = model instanceof ModelResult ? model : await evaluateModel(model, opts.params ?? {}, opts.evaluate);
  const parts = renderParts(r);
  if (!parts.length) {
    const why = r.ok ? "the model has no solid parts to render" : `the model did not evaluate: ${r.describeErrors() || "no parts"}`;
    return { pass: false, written: false, path, diffPixels: 0, diffRatio: 0, message: why };
  }
  const actual = quantized(renderImage(parts, { background: "dark", ...opts.render, width: opts.width ?? 256, height: opts.height ?? 192, view }), opts.quantize ?? 8);
  const update = opts.update ?? process.env.TSCAD_UPDATE_SNAPSHOTS === "1";
  if (!update && !existsSync(path) && process.env.CI && process.env.TSCAD_UPDATE_SNAPSHOTS !== "1") {
    // In CI a missing snapshot is a failure: it was never committed.
    return { pass: false, written: false, path, diffPixels: 0, diffRatio: 0, message: `no snapshot ${path} (CI doesn't write them: run the tests locally and commit the PNG)` };
  }
  if (update || !existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, encodePNG(toRGB(actual), actual.width, actual.height, 3));
    rmSync(diffPath, { force: true });
    return { pass: true, written: true, path, diffPixels: 0, diffRatio: 0, message: `wrote ${path}` };
  }
  const expected = decodePNG(readFileSync(path));
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { pass: false, written: false, path, diffPixels: actual.width * actual.height, diffRatio: 1, message: `${path} is ${expected.width}×${expected.height}, the render is ${actual.width}×${actual.height} (TSCAD_UPDATE_SNAPSHOTS=1 rewrites it)` };
  }
  const d = diffImages(expected, actual, opts.tolerance ?? 24);
  const max = opts.maxDiffRatio ?? 0.005;
  if (d.diffRatio <= max) {
    rmSync(diffPath, { force: true });
    return { pass: true, written: false, path, diffPixels: d.diffPixels, diffRatio: d.diffRatio, message: `matches ${path} (${(d.diffRatio * 100).toFixed(2)}% of pixels differ)` };
  }
  writeFileSync(diffPath, encodePNG(toRGB(d.image), d.image.width, d.image.height, 3));
  return {
    pass: false,
    written: false,
    path,
    diffPath,
    diffPixels: d.diffPixels,
    diffRatio: d.diffRatio,
    message: `${opts.name} (${view}) differs from ${path}: ${d.diffPixels} pixels (${(d.diffRatio * 100).toFixed(2)}%, allowed ${(max * 100).toFixed(2)}%). Diff: ${diffPath}. If the change is intended, rerun with TSCAD_UPDATE_SNAPSHOTS=1.`,
  };
}
