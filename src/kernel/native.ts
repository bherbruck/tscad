/**
 * The solidcore kernel as a native library through `bun:ffi`: the same engine as the wasm
 * build, 2–3x faster. Bun only; built with `bun scripts/build-native.ts` into
 * `native/<platform>-<arch>/`. {@link loadKernel} picks it up automatically.
 */
import type { Document, EvalOptions, EvalResult, PickInfo } from "../ir";
import { KernelPanic, type KernelHost, type MeshArrays } from "./index";

const EXT = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so";
const PREFIX = process.platform === "win32" ? "" : "lib";

/** Where the native library for this platform lives (or `TSCAD_NATIVE_LIB`). */
export function nativeLibraryPath(): string {
  if (process.env.TSCAD_NATIVE_LIB) return process.env.TSCAD_NATIVE_LIB;
  return new URL(`../../native/${process.platform}-${process.arch}/${PREFIX}tscad.${EXT}`, import.meta.url).pathname;
}

type Lib = {
  tscad_new(): unknown;
  tscad_free(n: unknown): void;
  tscad_call(n: unknown, ptr: unknown, len: number | bigint): number | bigint;
  tscad_result_ptr(n: unknown): unknown;
};

let opened: { lib: Lib; toArrayBuffer: (ptr: any, offset: number, len: number) => ArrayBuffer } | undefined;

async function open(): Promise<typeof opened> {
  if (opened) return opened;
  const path = nativeLibraryPath();
  const fs = await import("node:fs");
  if (!fs.existsSync(path)) return undefined;
  // the specifier is hidden from bundlers: this module only ever runs in bun
  const ffi: any = await import(/* @vite-ignore */ ["bun", "ffi"].join(":"));
  const { symbols } = ffi.dlopen(path, {
    tscad_new: { args: [], returns: "ptr" },
    tscad_free: { args: ["ptr"], returns: "void" },
    tscad_call: { args: ["ptr", "ptr", "usize"], returns: "usize" },
    tscad_result_ptr: { args: ["ptr"], returns: "ptr" },
  });
  opened = { lib: symbols as Lib, toArrayBuffer: ffi.toArrayBuffer };
  return opened;
}

/** A native kernel session (same API as the wasm one). */
export class NativeKernelHost implements KernelHost {
  #lib: Lib;
  #toArrayBuffer: (ptr: any, offset: number, len: number) => ArrayBuffer;
  #session: unknown;
  panics = 0;
  readonly version: string;

  private constructor(lib: NonNullable<typeof opened>) {
    this.#lib = lib.lib;
    this.#toArrayBuffer = lib.toArrayBuffer;
    this.#session = this.#lib.tscad_new();
    this.version = this.#call({ cmd: "version" }).json.ok as string;
  }

  /** @internal */
  static async create(): Promise<NativeKernelHost | undefined> {
    const lib = await open();
    return lib ? new NativeKernelHost(lib) : undefined;
  }

  #call(request: object): { json: any; bin: ArrayBuffer } {
    const bytes = new TextEncoder().encode(JSON.stringify(request));
    const len = Number(this.#lib.tscad_call(this.#session, bytes, bytes.length));
    const ptr = this.#lib.tscad_result_ptr(this.#session);
    // copy out: the buffer is reused by the next call
    const all = this.#toArrayBuffer(ptr, 0, len).slice(0);
    const head = new DataView(all).getUint32(0, true);
    // absent values are `undefined` from the wasm build (serde-wasm-bindgen): match it
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(all, 4, head)), (_k, v) => (v === null ? undefined : v));
    if (json.panic !== undefined) {
      this.panics++;
      throw new KernelPanic(json.panic);
    }
    if (json.error !== undefined) throw new Error(json.error);
    return { json, bin: all.slice(4 + head) };
  }

  async evaluate(document: Document, options?: EvalOptions): Promise<EvalResult> {
    return this.#call({ cmd: "evaluate", document, options }).json.ok;
  }

  #mesh(part: string, tolerance?: number): MeshArrays | undefined {
    const { json, bin } = this.#call({ cmd: "mesh", part, tolerance });
    if (!json.mesh) return undefined;
    const m = json.mesh;
    const f32 = ([at, n]: [number, number]) => new Float32Array(bin.slice(at, at + n * 4));
    const u32 = ([at, n]: [number, number]) => new Uint32Array(bin.slice(at, at + n * 4));
    return {
      positions: f32(m.positions),
      normals: f32(m.normals),
      indices: u32(m.indices),
      faceIds: u32(m.faceIds),
      edgePoints: f32(m.edgePoints),
      edgeCounts: u32(m.edgeCounts),
      edgeIds: u32(m.edgeIds),
    };
  }

  async mesh(part: string): Promise<MeshArrays | undefined> {
    return this.#mesh(part);
  }

  async meshAt(part: string, tolerance: number): Promise<MeshArrays> {
    const m = this.#mesh(part, tolerance);
    if (!m) throw new Error(`no mesh for ${part}`);
    return m;
  }

  async step(parts?: string[]): Promise<string> {
    return this.#call({ cmd: "step", parts }).json.ok;
  }

  async pickEdge(part: string, index: number): Promise<PickInfo> {
    return this.#call({ cmd: "pickEdge", part, index }).json.ok;
  }

  async pickFace(part: string, index: number): Promise<PickInfo> {
    return this.#call({ cmd: "pickFace", part, index }).json.ok;
  }

  async partNames(): Promise<string[]> {
    return this.#call({ cmd: "partNames" }).json.ok;
  }

  async clearCache(): Promise<void> {
    this.#call({ cmd: "clearCache" });
  }

  dispose(): void {
    this.#lib.tscad_free(this.#session);
  }
}

/** The native kernel, or `undefined` when no library is built for this platform. */
export function loadNativeKernel(): Promise<NativeKernelHost | undefined> {
  return NativeKernelHost.create();
}
