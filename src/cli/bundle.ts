/** Bundling with Bun.build: the viewer app (once per server) and the user's model (on every change). */
import { dirname, relative, resolve } from "node:path";
import type { BunPlugin } from "bun";

/** This package's root (holds `src/` and `wasm/`). */
export const PKG_ROOT = resolve(import.meta.dir, "../..");
export const SRC = resolve(PKG_ROOT, "src");
export const WASM_DIR = resolve(PKG_ROOT, "wasm");

/** URL prefix the app bundle is served under. */
export const APP_PREFIX = "/__tscad/";

/** `tscad` subpath → source entry (relative to src/). */
export const RUNTIME_ENTRIES: Record<string, string> = {
  tscad: "index.ts",
  "tscad/jsx-runtime": "jsx-runtime.ts",
  "tscad/jsx-dev-runtime": "jsx-dev-runtime.ts",
  "tscad/parts": "parts/index.ts",
};

export interface Asset {
  body: Uint8Array | string;
  type: string;
}

const TSCAD_RE = /^tscad(\/[\w-]+)?$/;

/**
 * Resolve `tscad`, `tscad/jsx-runtime`... in a user bundle to the app bundle's served entries,
 * so the user module and the worker share one instance of the runtime.
 */
export function browserRuntimePlugin(prefix = APP_PREFIX): BunPlugin {
  return {
    name: "tscad-runtime-external",
    setup(build) {
      build.onResolve({ filter: TSCAD_RE }, (args) => {
        const entry = RUNTIME_ENTRIES[args.path];
        if (!entry) return { path: `${prefix}${args.path.slice("tscad/".length)}.js`, external: true };
        return { path: `${prefix}${entry.replace(/\.ts$/, ".js")}`, external: true };
      });
    },
  };
}

/** Bundle the viewer app, the eval worker and the tscad runtime into memory (shared chunks). */
export async function buildApp(opts: { minify?: boolean; /** App entries (relative to src/); default the dev viewer. */ entries?: string[] } = {}): Promise<Map<string, Asset>> {
  const app = opts.entries ?? ["viewer/main.ts"];
  const entrypoints = [...Object.values(RUNTIME_ENTRIES), ...app, "viewer/worker.ts"].map((e) => resolve(SRC, e));
  const result = await Bun.build({
    entrypoints,
    root: SRC,
    target: "browser",
    format: "esm",
    splitting: true,
    // Keep identifiers: the runtime's source capture reads function names from stack frames.
    minify: opts.minify ? { whitespace: true, syntax: true, identifiers: false } : false,
    sourcemap: "linked",
    naming: { entry: "[dir]/[name].[ext]", chunk: "chunks/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    // The kernel loads node:fs only for file: URLs, never in the browser.
    external: ["node:fs/promises", "node:fs", "node:path", "node:url"],
    throw: false,
  });
  if (!result.success) throw new BundleError("Failed to bundle the tscad viewer", result.logs);
  const assets = new Map<string, Asset>();
  for (const out of result.outputs) {
    const path = out.path.replace(/^\.\//, "");
    assets.set(path, { body: new Uint8Array(await out.arrayBuffer()), type: mime(path) });
  }
  const css = await Bun.file(resolve(SRC, "viewer/styles.css")).text();
  assets.set("viewer/styles.css", { body: css, type: "text/css; charset=utf-8" });
  return assets;
}

export interface UserBundle {
  js: string;
  map?: string;
  /** Files that went into the bundle (absolute), for the watcher. */
  inputs: string[];
  millis: number;
}

export interface BuildMessage {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  lineText?: string;
  /** Source lines around `line`: `[lineNumber, text]`. */
  lines?: [number, string][];
}

export class BundleError extends Error {
  messages: BuildMessage[];
  constructor(message: string, logs: readonly (BuildMessage | any)[]) {
    const messages = logs.filter((l: any) => l.level === undefined || l.level === "error").map(toMessage);
    super(`${message}\n${messages.map((m) => `  ${m.file ? `${m.file}:${m.line}:${m.column}: ` : ""}${m.message}`).join("\n")}`);
    this.name = "BundleError";
    this.messages = messages;
  }
}

function toMessage(log: any): BuildMessage {
  const p = log.position;
  return {
    message: String(log.message ?? log),
    file: p?.file,
    line: p?.line,
    column: p?.column !== undefined ? Math.max(1, p.column) : undefined,
    lineText: p?.lineText,
  };
}

/** Bundle a user model for the browser; `tscad` imports stay external (served by the app). */
export async function buildUser(entry: string, root = dirname(entry)): Promise<UserBundle> {
  const t = performance.now();
  const inputs = new Set<string>();
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    sourcemap: "external",
    jsx: { runtime: "automatic", importSource: "tscad", development: false } as any,
    plugins: [
      browserRuntimePlugin(),
      {
        name: "tscad-track-inputs",
        setup(build) {
          build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
            inputs.add(args.path);
            return undefined as any;
          });
        },
      },
    ],
    throw: false,
  });
  if (!result.success) {
    const err = new BundleError(`Failed to bundle ${relative(process.cwd(), entry)}`, result.logs);
    for (const m of err.messages) {
      if (!m.file) continue;
      const abs = resolve(process.cwd(), m.file);
      try {
        const text = (await Bun.file(abs).text()).split("\n");
        if (m.line) {
          m.lines = [];
          for (let n = Math.max(1, m.line - 3); n <= Math.min(text.length, m.line + 2); n++) m.lines.push([n, text[n - 1] ?? ""]);
        }
      } catch {
        /* unreadable */
      }
      const r = relative(root, abs);
      m.file = r.startsWith("..") ? abs : r;
    }
    throw err;
  }
  let js = "", map: string | undefined;
  for (const out of result.outputs) {
    if (out.kind === "sourcemap") map = await out.text();
    else if (out.kind === "entry-point") js = await out.text();
  }
  // Make the map's sources project-relative (they show up in error overlays).
  if (map) {
    const m = JSON.parse(map);
    m.sources = (m.sources as string[]).map((s) => {
      const abs = resolve(process.cwd(), s);
      return relative(root, abs).startsWith("..") ? s : relative(root, abs);
    });
    map = JSON.stringify(m);
  }
  js = js.replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  return { js, map, inputs: [...inputs], millis: performance.now() - t };
}

export function mime(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".map") || path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
