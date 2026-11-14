/**
 * A stand-in for the eval Worker that talks to the dev server's `/__eval` socket instead: the
 * same messages, evaluated in the bun process with the native kernel (meshes arrive as binary
 * frames). Messages sent before the socket opens are queued.
 */
import type { FromWorker, ToWorker } from "./protocol";
import { decode, encode } from "./wire";

/** The eval worker on the server, over a WebSocket, with the Worker interface. */
export class RemoteWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  #ws: WebSocket;
  #queue: Uint8Array[] = [];

  constructor(path: string) {
    this.#ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`);
    this.#ws.binaryType = "arraybuffer";
    this.#ws.onopen = () => {
      for (const f of this.#queue) this.#ws.send(f as Uint8Array<ArrayBuffer>);
      this.#queue = [];
    };
    this.#ws.onmessage = (e) => {
      const data = decode<FromWorker>(e.data as ArrayBuffer);
      this.onmessage?.(new MessageEvent("message", { data }));
    };
    this.#ws.onclose = () => {
      this.onerror?.(new ErrorEvent("error", { message: "Lost the dev server's evaluation socket — restart `tscad dev` and reload." }));
    };
  }

  postMessage(msg: ToWorker) {
    const frame = encode(msg);
    if (this.#ws.readyState === WebSocket.OPEN) this.#ws.send(frame as Uint8Array<ArrayBuffer>);
    else this.#queue.push(frame);
  }

  terminate() {
    this.#ws.close();
  }
}
