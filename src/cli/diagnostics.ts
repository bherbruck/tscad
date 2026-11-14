/**
 * Model diagnostics for editors (`tscad dev --diagnostics`): after every rebuild the model is
 * rendered and evaluated in a bun Worker (the viewer's eval worker, default kernel) and its
 * problems become `{ file, line, column, severity, message }` items with absolute file paths.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SRC } from "./bundle";
import type { BunBundle } from "./model";

export interface DiagnosticItem {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  /** What produced it: render, kernel, sketch, assembly, warning, build. */
  source: string;
  /** The JSX element, when known (`fillet`, `sketch`, ...). */
  tag?: string;
}

/** Pure: worker-protocol messages (a result or an error) → diagnostics. */
export function diagnosticsFrom(msg: any, entry: string): DiagnosticItem[] {
  const out: DiagnosticItem[] = [];
  const at = (loc: any) => (loc && typeof loc.file === "string" && loc.line ? { file: loc.file.replace(/^file:\/\//, ""), line: loc.line, column: loc.column || 1 } : { file: entry, line: 1, column: 1 });
  if (msg?.type === "error") {
    const e = msg.error;
    out.push({ ...at(e.loc), severity: "error", message: e.message, source: e.stage === "kernel" ? "kernel" : "render" });
    return out;
  }
  if (msg?.type !== "result") return out;
  const d = msg.data;
  for (const p of d.parts ?? []) {
    if (p.error) out.push({ ...at(p.error.loc), severity: "error", message: `${p.error.op} failed in part "${p.name}": ${p.error.message}`, source: "kernel" });
    for (const w of p.warnings ?? []) out.push({ ...at(undefined), severity: "warning", message: `part "${p.name}": ${w}`, source: "kernel" });
  }
  for (const s of d.sketches ?? []) {
    if (s.status === "ok") continue;
    const free = (s.free ?? []).slice(0, 6).join(", ");
    out.push({
      ...at(s.loc),
      severity: s.status === "under" ? "info" : "warning",
      message: s.status === "under" ? `sketch is under-constrained: ${s.dof} degree${s.dof === 1 ? "" : "s"} of freedom left${free ? ` (${free}${s.free.length > 6 ? ", …" : ""})` : ""}` : `sketch: ${s.status}`,
      source: "sketch",
      tag: "sketch",
    });
  }
  for (const m of d.assembly?.mates ?? []) {
    if (!m.ok) out.push({ ...at(m.loc), severity: "error", message: `${m.type} mate ${m.a} → ${m.b} isn't satisfied (residual ${Number(m.residual).toFixed(3)} mm)`, source: "assembly", tag: "mate" });
  }
  // Core warnings read "file:line:col: <tag> message".
  for (const w of d.warnings ?? []) {
    const m = String(w).match(/^(.*?):(\d+):(\d+): (.*)$/s);
    if (m && /[\\/]|\.tsx?$/.test(m[1]!)) out.push({ file: m[1]!.replace(/^file:\/\//, ""), line: Number(m[2]), column: Number(m[3]) || 1, severity: "warning", message: m[4]!, source: "warning" });
    else out.push({ file: entry, line: 1, column: 1, severity: "warning", message: String(w), source: "warning" });
  }
  return out;
}

/** Runs the eval worker for diagnostics; one evaluation at a time, latest wins. */
export class DiagnosticsRunner {
  #worker: Worker;
  #ready: Promise<void>;
  #busy = false;
  #next: { bundle: BunBundle; entry: string } | undefined;
  #resolveRun?: (items: DiagnosticItem[]) => void;
  #entry = "";

  constructor(readonly onItems: (items: DiagnosticItem[]) => void) {
    this.#worker = new Worker(resolve(SRC, "viewer/worker.ts"), { type: "module" } as any);
    let ready!: () => void;
    this.#ready = new Promise((r) => (ready = r));
    this.#worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "ready") return ready();
      if (m.type === "result" || m.type === "error") this.#resolveRun?.(diagnosticsFrom(m, this.#entry));
    };
    // One kernel: diagnostics must not compete with the viewer for every core.
    this.#worker.postMessage({ type: "init", wasmUrl: "", glueUrl: "", native: true, pool: 1 });
  }

  /** Evaluate this bundle (defaults) and report; queued if a run is in flight. */
  update(bundle: BunBundle, entry: string) {
    this.#next = { bundle, entry };
    if (!this.#busy) void this.#drain();
  }

  async #drain() {
    this.#busy = true;
    await this.#ready;
    while (this.#next) {
      const { bundle, entry } = this.#next;
      this.#next = undefined;
      this.#entry = entry;
      const items = await new Promise<DiagnosticItem[]>((r) => {
        this.#resolveRun = r;
        this.#worker.postMessage({ type: "load", url: pathToFileURL(bundle.path).href, values: {}, map: bundle.map });
      });
      this.onItems(items);
    }
    this.#busy = false;
  }

  /** Bundle errors (the model didn't compile) as diagnostics, without evaluating. */
  static fromBuild(errors: { message: string; file?: string; line?: number; column?: number }[], root: string, entry: string): DiagnosticItem[] {
    return errors.map((e) => ({ file: e.file ? resolve(root, e.file) : entry, line: e.line ?? 1, column: e.column ?? 1, severity: "error" as const, message: e.message, source: "build" }));
  }

  dispose() {
    this.#worker.postMessage({ type: "dispose" });
    setTimeout(() => this.#worker.terminate(), 300);
  }
}
