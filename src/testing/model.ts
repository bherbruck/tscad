/** Evaluate a model for tests: compile + kernel, with meshes and helpers. */
import { compile, renderModule, type CompileResult, type RenderResult } from "../core/compile";
import { isElement, type Children, type Component } from "../core/element";
import type { ParamSchema } from "../core/params";
import { massOf } from "../core/materials";
import type { Document, EvalResult, PartResult } from "../ir";
import { loadKernel, type KernelHost, type MeshArrays } from "../kernel/index";
import { checkInterference, type InterferenceOptions, type InterferenceResult } from "../check/interference";
import { checkPrintability, type PrintabilityOptions, type PrintabilityResult } from "../check/printability";
import { checkWatertight, type WatertightResult } from "../check/watertight";

type Box = [[number, number, number], [number, number, number]];

/** A model module (`import * as model from "./model"`), a component, or an element. */
export type ModelInput = { default: Component<any>; params?: ParamSchema } | Component<any> | Children;

/** Options for {@link evaluateModel}. */
export interface EvaluateOptions {
  /** Kernel session (default: the shared one from `loadKernel()`). */
  kernel?: KernelHost;
  /** Chord tolerance for display meshes, mm. */
  tolerance?: number;
}

/** A compiled + evaluated model, with helpers for assertions. */
export class ModelResult {
  constructor(
    readonly compiled: CompileResult | RenderResult,
    readonly result: EvalResult,
    readonly kernel: KernelHost,
    readonly meshes: ReadonlyMap<string, MeshArrays>,
    /** Thrown while rendering/compiling (then `result` is an empty failure). */
    readonly error?: unknown,
  ) {}

  get document(): Document {
    return this.compiled.document;
  }
  /** Every part evaluated and none failed. */
  get ok(): boolean {
    return !this.error && this.result.ok && this.result.parts.length > 0;
  }
  get parts(): PartResult[] {
    return this.result.parts;
  }
  /** Values the model was rendered with (modules only). */
  get values(): Record<string, unknown> {
    return "values" in this.compiled ? (this.compiled.values as Record<string, unknown>) : {};
  }
  get warnings(): string[] {
    return this.compiled.warnings;
  }
  part(name: string): PartResult {
    const p = this.result.parts.find((x) => x.name === name);
    if (!p) throw new Error(`no part "${name}" (parts: ${this.result.parts.map((x) => x.name).join(", ")})`);
    return p;
  }
  /** Total volume (or one part's), mm³. */
  volume(part?: string): number {
    return (part ? [this.part(part)] : this.result.parts).reduce((s, p) => s + (p.volume ?? 0), 0);
  }
  /** Mass in grams from each part's material/density (parts without one count 0). */
  mass(part?: string): number {
    return (part ? [this.part(part)] : this.result.parts).reduce((s, p) => {
      const d = this.compiled.parts.find((i) => i.name === p.name)?.density;
      return s + (d && p.volume ? massOf(p.volume, d) : 0);
    }, 0);
  }
  /** Bounds of everything (or one part). */
  bbox(part?: string): Box | undefined {
    const boxes = (part ? [this.part(part)] : this.result.parts).map((p) => p.bbox).filter((b): b is Box => !!b);
    if (!boxes.length) return undefined;
    return [
      [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b[0][k]!))) as [number, number, number],
      [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b[1][k]!))) as [number, number, number],
    ];
  }
  /** Size of the bounds, `[x, y, z]` mm. */
  size(part?: string): [number, number, number] {
    const b = this.bbox(part);
    return b ? [b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]] : [0, 0, 0];
  }
  mesh(part: string): MeshArrays {
    const m = this.meshes.get(part);
    if (!m) throw new Error(`no mesh for part "${part}"`);
    return m;
  }
  /** Printability of each part (or one). */
  printability(opts?: PrintabilityOptions, part?: string): Map<string, PrintabilityResult> {
    const out = new Map<string, PrintabilityResult>();
    for (const [name, m] of this.meshes) if (!part || part === name) out.set(name, checkPrintability(m, opts));
    return out;
  }
  watertight(part?: string): Map<string, WatertightResult> {
    const out = new Map<string, WatertightResult>();
    for (const [name, m] of this.meshes) if (!part || part === name) out.set(name, checkWatertight(m));
    return out;
  }
  #interference?: Promise<InterferenceResult>;
  /** Pairwise interference between parts (computed once). */
  interference(opts?: InterferenceOptions): Promise<InterferenceResult> {
    if (opts) return checkInterference(this.kernel, this.document, { evalOptions: { noMesh: true }, ...opts });
    return (this.#interference ??= checkInterference(this.kernel, this.document, { evalOptions: { noMesh: true } }));
  }
  /** One-line description of failures, for messages. */
  describeErrors(): string {
    if (this.error) return String((this.error as Error)?.message ?? this.error);
    return this.result.parts
      .filter((p) => !p.ok)
      .map((p) => {
        const loc = p.error ? this.compiled.sourceMap[p.error.path] : undefined;
        return `${p.name}: ${p.error?.op} — ${p.error?.message}${loc ? ` (${loc.file}:${loc.line}:${loc.column} <${loc.tag}>)` : ""}`;
      })
      .join("; ");
  }
}

function isModule(x: unknown): x is { default: Component<any>; params?: ParamSchema } {
  return typeof x === "object" && x !== null && !isElement(x) && typeof (x as { default?: unknown }).default === "function";
}

/**
 * Compile and evaluate a model with the kernel. Never throws for modelling errors: check
 * `result.ok` / `expect(result).toEvaluate()`.
 *
 * @example
 * import * as bracket from "./bracket"
 * const r = await evaluateModel(bracket, { width: 80 })
 * expect(r).toEvaluate()
 */
export async function evaluateModel(input: ModelInput, params: Record<string, unknown> = {}, opts: EvaluateOptions = {}): Promise<ModelResult> {
  const kernel = opts.kernel ?? (await loadKernel());
  let compiled: CompileResult | RenderResult;
  try {
    if (isModule(input)) compiled = renderModule(input, params);
    else if (typeof input === "function") compiled = renderModule({ default: input as Component<any> }, params);
    else compiled = compile(input as Children);
  } catch (e) {
    const empty: EvalResult = { ok: false, parts: [], cacheHits: 0, cacheMisses: 0, cacheSize: 0, millis: 0, frames: {} };
    return new ModelResult({ document: { parts: [] }, sourceMap: {}, warnings: [], parts: [], drawings: [] } as unknown as CompileResult, empty, kernel, new Map(), e);
  }
  const result = await kernel.evaluate(compiled.document, opts.tolerance !== undefined ? { tolerance: opts.tolerance } : undefined);
  const meshes = new Map<string, MeshArrays>();
  for (const p of result.parts) {
    if (!p.ok || p.empty) continue;
    const m = await kernel.mesh(p.name);
    if (m) meshes.set(p.name, m);
  }
  return new ModelResult(compiled, result, kernel, meshes);
}
