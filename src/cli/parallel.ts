/**
 * Parallel part evaluation in bun: independent parts go to separate kernel **processes** (the
 * native kernel holds one process-global lock, so threads don't help). Same sticky assignment as
 * the viewer's pool (src/viewer/pool.ts). `createParallelKernel()` wraps it all as a KernelHost,
 * so `tscad build`, the MCP server and the dev server's evaluator use it unchanged.
 */
import { resolve } from "node:path";
import { createKernel, KernelPanic, type KernelHost, type MeshArrays } from "../kernel";
import type { Document, EvalOptions, EvalResult, PickInfo } from "../ir";
import { LocalEvaluator, Pool, type Evaluated, type Evaluator } from "../viewer/pool";

const CHILD = resolve(import.meta.dir, "kernel-child.ts");
const live = new Set<ProcessEvaluator>();

/** A kernel in a child bun process. Crashes reject the pending calls with a KernelPanic and the next call respawns it. */
export class ProcessEvaluator implements Evaluator {
  #proc: ReturnType<typeof Bun.spawn> | undefined;
  #id = 0;
  #waiting = new Map<number, { resolve: (v: any) => void; reject: (e: unknown) => void }>();
  /** Times the process died and was restarted. */
  restarts = 0;

  constructor() {
    live.add(this);
  }

  #spawn() {
    const proc = Bun.spawn(["bun", CHILD], {
      stdio: ["ignore", "ignore", "inherit"],
      serialization: "advanced",
      ipc: (m: any) => {
        const w = this.#waiting.get(m.id);
        if (!w) return;
        this.#waiting.delete(m.id);
        this.#idle();
        if (m.ok) w.resolve(m.value);
        else w.reject(m.panic ? new KernelPanic(m.error) : new Error(m.error));
      },
      onExit: (_p: unknown, code: number | null, signal: string | number | null) => {
        if (this.#proc !== proc) return;
        this.#proc = undefined;
        if (!this.#waiting.size) return;
        this.restarts++;
        const err = new KernelPanic(`kernel process exited (${signal ?? `code ${code}`}); it will be restarted`);
        for (const w of this.#waiting.values()) w.reject(err);
        this.#waiting.clear();
      },
    } as any);
    this.#proc = proc;
    return proc;
  }

  /** An idle kernel process must not keep the parent alive (CLI runs exit when they're done). */
  #idle() {
    if (!this.#waiting.size) this.#proc?.unref();
  }

  #call<T>(op: string, args: unknown[]): Promise<T> {
    const proc = this.#proc ?? this.#spawn();
    proc.ref();
    const id = ++this.#id;
    return new Promise<T>((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      proc.send({ id, op, args });
    });
  }

  /** Start the process now (so the first evaluate doesn't pay for it on the critical path). */
  warm() {
    return this.#call<string>("ping", []);
  }
  async evaluate(doc: Document, opts?: EvalOptions): Promise<Evaluated> {
    const v = await this.#call<{ result: EvalResult; meshes: [string, MeshArrays][] }>("evaluate", [doc, opts]);
    return { result: v.result, meshes: new Map(v.meshes) };
  }
  pick(kind: "edge" | "face", part: string, index: number) {
    return this.#call<PickInfo>("pick", [kind, part, index]);
  }
  meshAt(part: string, tolerance: number) {
    return this.#call<MeshArrays>("meshAt", [part, tolerance]);
  }
  step(parts: string[]) {
    return this.#call<string>("step", [parts]);
  }
  /** For tests: the child's pid. */
  get pid() {
    return this.#proc?.pid;
  }
  /** For tests: kill the process as if it crashed. */
  crash() {
    this.#proc?.kill("SIGKILL");
  }
  dispose() {
    live.delete(this);
    const p = this.#proc;
    this.#proc = undefined;
    for (const w of this.#waiting.values()) w.reject(new Error("kernel process closed"));
    this.#waiting.clear();
    p?.kill();
  }
}

/** Kill every kernel process (also run on exit). */
export function disposeKernelProcesses() {
  for (const p of [...live]) p.dispose();
}
process.on("exit", disposeKernelProcesses);

/** Default pool size: cores − 1, at most 4 (the caller also caps it by the part count). */
export function defaultParallelism(): number {
  return Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
}

/**
 * A KernelHost whose `evaluate` spreads a document's parts over this process's kernel and up to
 * `max − 1` kernel processes. One-part documents stay in-process. Meshes, picks, STEP and
 * `meshAt` are routed to each part's kernel.
 */
export class ParallelKernelHost implements KernelHost {
  readonly pool: Pool;
  #local: KernelHost;
  #meshes = new Map<string, MeshArrays>();
  #doc: Document | undefined;

  constructor(local: KernelHost, max = defaultParallelism()) {
    this.#local = local;
    this.pool = new Pool(new LocalEvaluator(local), max, () => {
      const p = new ProcessEvaluator();
      void p.warm().catch(() => {});
      return p;
    });
  }
  get version() {
    return this.#local.version;
  }
  get panics() {
    return this.#local.panics;
  }
  async evaluate(document: Document, options?: EvalOptions): Promise<EvalResult> {
    const r = await this.pool.evaluate(document, options);
    this.#doc = document;
    this.#meshes = r.meshes;
    return r.result;
  }
  async mesh(part: string) {
    return this.#meshes.get(part);
  }
  meshAt(part: string, tolerance: number) {
    return this.pool.meshAt(part, tolerance);
  }
  step(parts?: string[]) {
    return this.pool.step(parts ?? (this.#doc?.parts ?? []).map((p) => p.name ?? ""), this.#doc);
  }
  pickEdge(part: string, index: number) {
    return this.pool.pick("edge", part, index);
  }
  pickFace(part: string, index: number) {
    return this.pool.pick("face", part, index);
  }
  async partNames() {
    return (this.#doc?.parts ?? []).map((p) => p.name ?? "");
  }
  clearCache() {
    return this.#local.clearCache();
  }
  dispose() {
    this.pool.dispose();
  }
}

let shared: Promise<ParallelKernelHost> | undefined;

/** The shared parallel kernel for this process (the in-process kernel + kernel processes on demand). */
export function createParallelKernel(max?: number): Promise<ParallelKernelHost> {
  if (max !== undefined) return createKernel().then((k) => new ParallelKernelHost(k, max));
  return (shared ??= createKernel().then((k) => new ParallelKernelHost(k)));
}

/** Evaluate a document with its parts spread over kernel processes (≥ 2 parts); meshes via `kernel.mesh()`. */
export async function evaluateParallel(document: Document, options?: EvalOptions): Promise<{ result: EvalResult; kernel: ParallelKernelHost }> {
  const kernel = await createParallelKernel();
  return { result: await kernel.evaluate(document, options), kernel };
}
