/**
 * Server-side evaluation for `tscad dev`: the browser's eval-worker protocol, served by a bun
 * Worker running the same `src/viewer/worker.ts` with the native kernel. One worker per viewer
 * connection; messages travel as binary frames (see src/viewer/wire.ts) so meshes are not
 * re-encoded.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SRC } from "./bundle";
import type { BunBundle } from "./model";
import { decode, encode } from "../viewer/wire";

/** One browser connection evaluated on the server: a bun worker running the eval worker, bridged to the WebSocket. */
export class EvalSession {
  #worker: Worker;
  #closed = false;

  constructor(
    readonly send: (frame: Uint8Array) => void,
    readonly bundle: () => BunBundle | undefined,
    /** Project root: absolute source paths are sent relative to it. */
    readonly root: string,
  ) {
    this.#worker = new Worker(resolve(SRC, "viewer/worker.ts"), { type: "module" } as any);
    this.#worker.onmessage = (e: MessageEvent) => {
      if (!this.#closed) this.send(encode(relativize(e.data, this.root)));
    };
    this.#worker.onerror = (e: ErrorEvent) => {
      if (!this.#closed) this.send(encode({ type: "error", error: { stage: "worker", message: e.message || "server eval worker failed" } }));
    };
  }

  handle(frame: ArrayBuffer | Uint8Array) {
    const msg = decode<any>(frame);
    if (msg.type === "init") return this.#worker.postMessage({ ...msg, native: true });
    if (msg.type === "load") {
      const b = this.bundle();
      if (!b) return;
      return this.#worker.postMessage({ type: "load", url: pathToFileURL(b.path).href, values: msg.values, map: b.map });
    }
    this.#worker.postMessage(msg);
  }

  close() {
    this.#closed = true;
    // Let the worker stop its kernel processes, then end it.
    this.#worker.postMessage({ type: "dispose" });
    setTimeout(() => this.#worker.terminate(), 300);
  }
}

/** `file` fields under `root` become project-relative (like the browser bundle's source map). */
function relativize(v: any, root: string): any {
  if (Array.isArray(v)) return v.map((x) => relativize(x, root));
  if (!v || typeof v !== "object" || ArrayBuffer.isView(v)) return v;
  const out: any = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === "file" && typeof x === "string") out[k] = x.startsWith(`${root}/`) ? x.slice(root.length + 1) : x.replace(/^file:\/\//, "");
    else out[k] = relativize(x, root);
  }
  return out;
}
