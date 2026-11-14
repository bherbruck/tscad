/**
 * Parallel part evaluation: independent parts go to separate kernel instances, each in its own
 * worker (nested workers spawned by the eval worker, sharing one compiled wasm module). Parts
 * stick to the evaluator that built them so each kernel's subtree cache keeps hitting; new parts
 * go to the least-loaded one. Picks, meshes and STEP are routed to a part's owner.
 */
import { createKernel, loadKernel, type KernelHost, type MeshArrays, KernelPanic } from "../kernel";
import type { Document, EvalOptions, EvalResult, Part, PartResult, PickInfo } from "../ir";

/** An evaluation and its meshes. */
export interface Evaluated {
  result: EvalResult;
  meshes: Map<string, MeshArrays>;
}

/** Something that evaluates documents: a kernel in this thread, a worker, or a process. */
export interface Evaluator {
  evaluate(doc: Document, opts?: EvalOptions): Promise<Evaluated>;
  pick(kind: "edge" | "face", part: string, index: number): Promise<PickInfo>;
  meshAt(part: string, tolerance: number): Promise<MeshArrays>;
  step(parts: string[]): Promise<string>;
  dispose(): void;
}

/** The eval worker's own kernel. */
export class LocalEvaluator implements Evaluator {
  constructor(readonly kernel: KernelHost) {}

  async evaluate(doc: Document, opts?: EvalOptions): Promise<Evaluated> {
    const result = await this.kernel.evaluate(doc, opts);
    const meshes = new Map<string, MeshArrays>();
    if (!opts?.noMesh) {
      for (const p of result.parts) {
        if (!p.ok || p.empty) continue;
        const m = await this.kernel.mesh(p.name);
        if (m) meshes.set(p.name, m);
      }
    }
    return { result, meshes };
  }
  pick(kind: "edge" | "face", part: string, index: number) {
    return kind === "edge" ? this.kernel.pickEdge(part, index) : this.kernel.pickFace(part, index);
  }
  meshAt(part: string, tolerance: number) {
    return this.kernel.meshAt(part, tolerance);
  }
  step(parts: string[]) {
    return this.kernel.step(parts);
  }
  dispose() {}
}

type ChildOp = "evaluate" | "pick" | "meshAt" | "step";

/** A kernel in a nested worker. */
export class ChildEvaluator implements Evaluator {
  #worker: Worker;
  #id = 0;
  #waiting = new Map<number, { resolve: (v: any) => void; reject: (e: unknown) => void }>();
  ready: Promise<void>;

  /** `module` undefined: a native kernel (bun) in the child. */
  constructor(workerUrl: string, module: WebAssembly.Module | undefined, glueUrl: string) {
    this.#worker = new Worker(workerUrl, { type: "module" });
    let readyResolve!: () => void, readyReject!: (e: unknown) => void;
    this.ready = new Promise((res, rej) => ((readyResolve = res), (readyReject = rej)));
    this.#worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "child-ready") {
        this.#ready = true;
        return readyResolve();
      }
      if (m.type === "child-failed") return readyReject(new Error(m.error));
      const w = this.#waiting.get(m.id);
      if (!w) return;
      this.#waiting.delete(m.id);
      if (m.ok) w.resolve(m.value);
      else w.reject(m.panic ? new KernelPanic(m.error) : new Error(m.error));
    };
    this.#worker.onerror = (e) => readyReject(new Error(e.message || "kernel worker failed"));
    this.#worker.postMessage({ type: "child-init", module, glueUrl, native: !module });
  }

  #ready = false;

  /** Posts synchronously once ready, so a job is out before the caller blocks on its own kernel. */
  #call<T>(op: ChildOp, args: unknown[]): Promise<T> {
    const send = () =>
      new Promise<T>((resolve, reject) => {
        const id = ++this.#id;
        this.#waiting.set(id, { resolve, reject });
        this.#worker.postMessage({ type: "child", id, op, args });
      });
    return this.#ready ? send() : this.ready.then(send);
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
  dispose() {
    this.#worker.terminate();
  }
}

/** Serve a {@link ChildEvaluator} from inside a nested worker. */
export function serveChild(scope: DedicatedWorkerGlobalScope, module: WebAssembly.Module | undefined, glueUrl: string) {
  // No module: bun's default kernel (a native session of its own).
  const local = (module ? loadKernel(module, glueUrl) : createKernel()).then((k) => new LocalEvaluator(k));
  local.then(
    () => scope.postMessage({ type: "child-ready" }),
    (e) => scope.postMessage({ type: "child-failed", error: String(e?.message ?? e) }),
  );
  scope.onmessage = async (e: MessageEvent) => {
    const { id, op, args } = e.data as { id: number; op: ChildOp; args: any[] };
    try {
      const ev = await local;
      let value: unknown;
      const transfer: Transferable[] = [];
      const take = (m: MeshArrays) => {
        for (const a of Object.values(m)) transfer.push((a as ArrayBufferView).buffer as ArrayBuffer);
      };
      if (op === "evaluate") {
        const r = await ev.evaluate(args[0], args[1]);
        for (const m of r.meshes.values()) take(m);
        value = { result: r.result, meshes: [...r.meshes] };
      } else if (op === "pick") value = await ev.pick(args[0], args[1], args[2]);
      else if (op === "meshAt") {
        const m = await ev.meshAt(args[0], args[1]);
        take(m);
        value = m;
      } else value = await ev.step(args[0]);
      scope.postMessage({ type: "child-reply", id, ok: true, value }, transfer);
    } catch (err: any) {
      scope.postMessage({ type: "child-reply", id, ok: false, error: String(err?.message ?? err), panic: err instanceof KernelPanic });
    }
  };
}

/** Assigns parts to evaluators and merges their results. */
export class Pool {
  readonly evaluators: Evaluator[];
  #owner = new Map<string, number>();
  #cost = new Map<string, number>();
  #spawn: () => Evaluator;
  #max: number;

  constructor(local: Evaluator, max: number, spawn: () => Evaluator) {
    this.evaluators = [local];
    this.#max = Math.max(1, max);
    this.#spawn = spawn;
  }

  get size() {
    return this.evaluators.length;
  }

  ownerOf(part: string): Evaluator {
    return this.evaluators[this.#owner.get(part) ?? 0]!;
  }

  /** Who evaluates which part this time (sticky; newcomers go to the lightest evaluator). */
  #assign(parts: Part[]): number[][] {
    const n = Math.min(this.#max, parts.length);
    while (this.evaluators.length < n) this.evaluators.push(this.#spawn());
    const load = this.evaluators.map(() => 0);
    const groups: number[][] = this.evaluators.map(() => []);
    const fresh: number[] = [];
    parts.forEach((p, i) => {
      const o = this.#owner.get(p.name ?? "");
      if (o !== undefined && o < this.evaluators.length) {
        groups[o]!.push(i);
        load[o]! += this.#cost.get(p.name ?? "") ?? 1;
      } else fresh.push(i);
    });
    for (const i of fresh) {
      const target = parts.length <= 1 ? 0 : load.indexOf(Math.min(...load));
      groups[target]!.push(i);
      load[target]! += this.#cost.get(parts[i]!.name ?? "") ?? 1;
      this.#owner.set(parts[i]!.name ?? "", target);
    }
    return groups;
  }

  async evaluate(doc: Document, opts?: EvalOptions): Promise<Evaluated> {
    const parts = doc.parts ?? [];
    if (parts.length <= 1 || this.#max <= 1) {
      for (const p of parts) this.#owner.set(p.name ?? "", 0);
      return this.evaluators[0]!.evaluate(doc, opts);
    }
    const groups = this.#assign(parts);
    // Children must be up before the local kernel blocks this thread.
    await Promise.all(this.evaluators.map((e) => (e as ChildEvaluator).ready));
    const t = performance.now();
    // Hand out the children's jobs first (posted synchronously), then run ours.
    const order = groups.map((_, e) => e).reverse();
    const jobs: Promise<{ g: number[]; r: Evaluated } | undefined>[] = [];
    for (const e of order) {
      const g = groups[e]!;
      jobs[e] = g.length ? this.evaluators[e]!.evaluate({ parts: g.map((i) => parts[i]!) }, opts).then((r) => ({ g, r })) : Promise.resolve(undefined);
    }
    const outs = await Promise.all(jobs);
    const byIndex: PartResult[] = new Array(parts.length);
    const meshes = new Map<string, MeshArrays>();
    let hits = 0, misses = 0, size = 0;
    const frames: Record<string, number[]> = {};
    for (const o of outs) {
      if (!o) continue;
      o.r.result.parts.forEach((pr, k) => {
        const i = o.g[k]!;
        // Error paths count parts within the sub-document: put the model's part index back.
        if (pr.error) pr.error = { ...pr.error, path: pr.error.path.replace(/^parts\/\d+/, `parts/${i}`) };
        byIndex[i] = pr;
      });
      for (const [name, m] of o.r.meshes) meshes.set(name, m);
      // Face frames are keyed by IR path: renumber the sub-document's part index too.
      // (older wasm builds returned a Map)
      const fr = o.r.result.frames as Record<string, number[]> | Map<string, number[]> | undefined;
      for (const [k, v] of fr instanceof Map ? fr : Object.entries(fr ?? {})) {
        frames[k.replace(/^parts\/(\d+)/, (_m, i) => `parts/${o.g[Number(i)]}`)] = v;
      }
      hits += o.r.result.cacheHits;
      misses += o.r.result.cacheMisses;
      size += o.r.result.cacheSize;
    }
    for (const pr of byIndex) if (pr) this.#cost.set(pr.name, Math.max(pr.millis, 0.1));
    const result: EvalResult = {
      ok: byIndex.every((p) => p?.ok),
      parts: byIndex,
      cacheHits: hits,
      cacheMisses: misses,
      cacheSize: size,
      millis: performance.now() - t,
      frames,
    } as EvalResult;
    return { result, meshes };
  }

  pick(kind: "edge" | "face", part: string, index: number) {
    return this.ownerOf(part).pick(kind, part, index);
  }

  meshAt(part: string, tolerance: number) {
    return this.ownerOf(part).meshAt(part, tolerance);
  }

  /** STEP of parts that may live in different kernels: rebuilt together in the local kernel when split. */
  async step(parts: string[], doc: Document | undefined): Promise<string> {
    const owners = new Set(parts.map((p) => this.#owner.get(p) ?? 0));
    if (owners.size <= 1) return this.ownerOf(parts[0] ?? "").step(parts);
    const local = this.evaluators[0]!;
    const want = (doc?.parts ?? []).filter((p) => parts.includes(p.name ?? ""));
    await local.evaluate({ parts: want }, { noMesh: true });
    const text = await local.step(parts);
    // Put the local kernel back on its own parts (cached, so cheap).
    const mine = (doc?.parts ?? []).filter((p) => (this.#owner.get(p.name ?? "") ?? 0) === 0);
    await local.evaluate({ parts: mine }, { noMesh: true });
    return text;
  }

  /** Re-evaluate the local kernel's own parts (after borrowing it for STEP or checks). */
  async restoreLocal(doc: Document) {
    const mine = (doc.parts ?? []).filter((p) => (this.#owner.get(p.name ?? "") ?? 0) === 0);
    await this.evaluators[0]!.evaluate({ parts: mine }, { noMesh: true });
  }

  dispose() {
    for (const e of this.evaluators.slice(1)) e.dispose();
    this.evaluators.length = 1;
    this.#owner.clear();
  }
}
