/**
 * The solidcore kernel in WebAssembly, for bun and the browser.
 *
 * `loadKernel()` gives a {@link KernelHost}: a wasm-bindgen `Kernel` session that survives a
 * kernel panic (the wasm instance is rebuilt and the panic is thrown as a {@link KernelPanic}
 * with Rust's own message), and that turns raw meshes into plain typed arrays.
 */
import type { Document, EvalOptions, EvalResult, PickInfo } from "../ir";
import type * as Glue from "../../wasm/tscad_wasm";

/** A part's display mesh as typed arrays. */
export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** B-rep face (record index) of each triangle. */
  faceIds: Uint32Array;
  /** Points of every drawn edge polyline end to end, xyz. */
  edgePoints: Float32Array;
  /** Point count of each polyline. */
  edgeCounts: Uint32Array;
  /** B-rep edge (record index) of each polyline. */
  edgeIds: Uint32Array;
}

/** The kernel panicked (a solidcore bug, not bad input). The session was rebuilt; retry is safe. */
export class KernelPanic extends Error {
  constructor(message: string) {
    super(`solidcore panicked: ${message}`);
    this.name = "KernelPanic";
  }
}

/** Where the wasm binary comes from. Default: `wasm/tscad_wasm_bg.wasm` next to this package. */
export type WasmSource = string | URL | ArrayBuffer | Uint8Array | WebAssembly.Module | Response;

const GLUE_URL = new URL("../../wasm/tscad_wasm.js", import.meta.url).href;
const WASM_URL = new URL("../../wasm/tscad_wasm_bg.wasm", import.meta.url);

let lastPanic = "";
(globalThis as any).__tscadPanic = (message: string) => {
  lastPanic = message;
};

async function compile(source: WasmSource | undefined): Promise<WebAssembly.Module> {
  if (source instanceof WebAssembly.Module) return source;
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) return WebAssembly.compile(source as BufferSource);
  if (source instanceof Response) return WebAssembly.compile(await source.arrayBuffer());
  const url = source === undefined ? WASM_URL : new URL(String(source), typeof location !== "undefined" ? location.href : import.meta.url);
  if (url.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    return WebAssembly.compile(await readFile(url));
  }
  return WebAssembly.compile(await (await fetch(url)).arrayBuffer());
}

let generation = 0;

async function instantiate(module: WebAssembly.Module, glueUrl: string): Promise<typeof Glue> {
  // A fresh copy of the glue module per instance: wasm-bindgen's glue keeps one instance per
  // module record, and a panicked instance must not be reused.
  const glue: typeof Glue = await import(/* @vite-ignore */ `${glueUrl}${generation++ ? `?instance=${generation}` : ""}`);
  glue.initSync({ module });
  return glue;
}

function isTrap(e: unknown): boolean {
  return e instanceof WebAssembly.RuntimeError;
}

/** A kernel session that rebuilds itself after a panic. */
export class KernelHost {
  #glue: typeof Glue;
  #kernel: Glue.Kernel;
  #module: WebAssembly.Module;
  #glueUrl: string;
  /** Panics recovered from so far. */
  panics = 0;

  private constructor(glue: typeof Glue, module: WebAssembly.Module, glueUrl: string) {
    this.#glue = glue;
    this.#module = module;
    this.#glueUrl = glueUrl;
    this.#kernel = new glue.Kernel();
  }

  /** @internal */
  static async create(source?: WasmSource, glueUrl = GLUE_URL): Promise<KernelHost> {
    const module = await compile(source);
    return new KernelHost(await instantiate(module, glueUrl), module, glueUrl);
  }

  /** The kernel crate's version. */
  get version(): string {
    return this.#glue.version();
  }

  async #recover(): Promise<never> {
    const message = lastPanic || "unknown panic";
    lastPanic = "";
    this.panics++;
    this.#glue = await instantiate(this.#module, this.#glueUrl);
    this.#kernel = new this.#glue.Kernel();
    throw new KernelPanic(message);
  }

  async #call<T>(f: (k: Glue.Kernel) => T): Promise<T> {
    try {
      return f(this.#kernel);
    } catch (e) {
      if (isTrap(e)) return this.#recover();
      throw e;
    }
  }

  /** Evaluate every part (unchanged subtrees come from the last evaluation's cache). */
  evaluate(document: Document, options?: EvalOptions): Promise<EvalResult> {
    return this.#call((k) => k.evaluate(document, options));
  }

  /** The display mesh of `part` from the last evaluation. */
  mesh(part: string): Promise<MeshArrays | undefined> {
    return this.#call((k) => {
      const m = k.mesh(part);
      return m ? arrays(m) : undefined;
    });
  }

  /** The mesh of `part` at chord tolerance `tolerance` mm (finer for export). */
  meshAt(part: string, tolerance: number): Promise<MeshArrays> {
    return this.#call((k) => arrays(k.meshAt(part, tolerance)));
  }

  /** STEP AP242 text of the named parts (all when none). */
  step(parts?: string[]): Promise<string> {
    return this.#call((k) => k.step(parts));
  }

  pickEdge(part: string, index: number): Promise<PickInfo> {
    return this.#call((k) => k.pickEdge(part, index));
  }

  pickFace(part: string, index: number): Promise<PickInfo> {
    return this.#call((k) => k.pickFace(part, index));
  }

  partNames(): Promise<string[]> {
    return this.#call((k) => k.partNames());
  }

  clearCache(): Promise<void> {
    return this.#call((k) => k.clearCache());
  }

  /** Free the session. */
  dispose(): void {
    this.#kernel.free();
  }
}

function arrays(m: Glue.Mesh): MeshArrays {
  const out: MeshArrays = {
    positions: m.positions,
    normals: m.normals,
    indices: m.indices,
    faceIds: m.faceIds,
    edgePoints: m.edgePoints,
    edgeCounts: m.edgeCounts,
    edgeIds: m.edgeIds,
  };
  m.free();
  return out;
}

let shared: Promise<KernelHost> | undefined;

/**
 * Load the kernel. Without arguments the session is shared (loaded once per process/page);
 * with a `source` a new session is made from it.
 */
export function loadKernel(source?: WasmSource, glueUrl?: string): Promise<KernelHost> {
  if (source !== undefined || glueUrl !== undefined) return KernelHost.create(source, glueUrl);
  return (shared ??= KernelHost.create());
}
