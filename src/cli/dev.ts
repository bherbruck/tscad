/**
 * `tscad dev`: a Bun.serve dev server. Serves the viewer app, the kernel wasm and the user's model
 * bundle; watches the model (and its local imports) and pushes reloads over a WebSocket.
 */
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { rmSync } from "node:fs";
import { APP_PREFIX, type Asset, buildApp, buildUser, BundleError, type BuildMessage, mime, SRC, WASM_DIR } from "./bundle";
import { EvalSession } from "./eval-server";
import { discoverModels, ThumbnailCache } from "./gallery";
import { applyChanges } from "../index";
import { type DiagnosticItem, DiagnosticsRunner } from "./diagnostics";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundleModel, type BunBundle } from "./model";
import { loadKernel, WasmKernelHost } from "../kernel";

/** Options of `tscad dev`. */
export interface DevOptions {
  file: string;
  port?: number;
  host?: string;
  /** Called on every rebuild (for logging). */
  onBuild?: (e: { ok: true; millis: number; version: number; file?: string } | { ok: false; errors: BuildMessage[] }) => void;
  quiet?: boolean;
  /**
   * Where models are evaluated: `"server"` (in this bun process, native kernel, meshes streamed
   * over a WebSocket), `"browser"` (wasm in a web worker) or `"auto"` (server when the native
   * kernel loads). Default `"auto"`.
   */
  evaluate?: "auto" | "server" | "browser";
  /** Paths in source maps and diagnostics are relative to this (default: the model's directory). */
  root?: string;
  /** Evaluate after every rebuild and publish problems (`/__diagnostics`, `diagnostics` socket messages). */
  diagnostics?: boolean;
  /** `file` is a folder: serve a gallery of every model in it (thumbnails rendered in the background). */
  gallery?: boolean;
}

/** A running dev server. */
export interface DevServer {
  url: string;
  port: number;
  server: Server<WsData>;
  /** Where models are evaluated. */
  evalMode: "server" | "browser";
  /** Whether bun has the native kernel (else server-side evaluation uses the wasm). */
  nativeKernel: boolean;
  rebuild(): Promise<void>;
  stop(): Promise<void>;
}

type State =
  | { type: "bundle"; url: string; file: string; version: number; millis: number }
  | { type: "bundle-error"; errors: BuildMessage[] }
  | { type: "building" };

/** Start the dev server: viewer app, model bundling with hot reload, WebSocket and HTTP API. */
export async function startDev(opts: DevOptions): Promise<DevServer> {
  const galleryRoot = opts.gallery ? resolve(opts.file) : undefined;
  const firstModel = galleryRoot ? discoverModels(galleryRoot)[0]?.file : undefined;
  // In gallery mode the viewer shows whichever model was opened last (initially the first one).
  let entry = galleryRoot ? (firstModel ?? join(galleryRoot, "index.tsx")) : resolve(opts.file);
  const root = resolve(opts.root ?? galleryRoot ?? dirname(entry));
  const labelOf = (f: string) => {
    const fromRoot = opts.root ? relative(root, f) : relative(process.cwd(), f);
    return fromRoot && !fromRoot.startsWith("..") ? fromRoot : basename(f);
  };
  let fileLabel = labelOf(entry);

  let [app, html] = await Promise.all([buildApp(), Bun.file(resolve(SRC, "viewer/index.html")).text()]);
  const evalMode = await chooseEvalMode(opts.evaluate ?? "auto");
  const makePage = () => html.replace(
    "<!--TSCAD_CONFIG-->",
    `<script>window.__TSCAD__ = ${JSON.stringify({ file: fileLabel, ws: "/__ws", wasmUrl: "/wasm/tscad_wasm_bg.wasm", glueUrl: "/wasm/tscad_wasm.js", workerUrl: `${APP_PREFIX}viewer/worker.js`, ...(evalMode === "server" ? { remoteEval: "/__eval" } : {}), ...(galleryRoot ? { gallery: "/" } : {}) })};</script>`,
  );
  let page = makePage();

  let version = 0;
  let bundle: { js: string; map?: string } | undefined;
  /** The same model bundled for bun (server-side evaluation); the last two stay on disk. */
  let bunBundles: BunBundle[] = [];
  let state: State = { type: "building" };
  let watched = new Set<string>();

  let diagnostics: DiagnosticItem[] = [];
  /** Bumped on every new set; `/__diagnostics?since=n` long-polls until it moves past n. */
  let diagVersion = 0;
  const diagWaiters = new Set<() => void>();
  const publishDiagnostics = (items: DiagnosticItem[]) => {
    diagnostics = items;
    diagVersion++;
    broadcast({ type: "diagnostics", file: entry, items, version: diagVersion });
    for (const w of diagWaiters) w();
    diagWaiters.clear();
  };
  const runner = opts.diagnostics ? new DiagnosticsRunner(publishDiagnostics) : undefined;
  const bunNeeded = evalMode === "server" || !!runner;

  const sockets = new Set<ServerWebSocket<WsData>>();
  const broadcast = (msg: State | { type: string; [k: string]: unknown }) => {
    const text = JSON.stringify(msg);
    for (const ws of sockets) ws.send(text);
  };

  async function rebuild() {
    broadcast({ type: "building" });
    try {
      const [b, bb] = await Promise.all([buildUser(entry, root), bunNeeded ? bundleModel(entry) : undefined]);
      bundle = b;
      if (bb) {
        bunBundles.push(bb);
        // Viewers may still be importing the previous one.
        for (const old of bunBundles.splice(0, Math.max(0, bunBundles.length - 2))) rmSync(old.path, { force: true });
      }
      version++;
      state = { type: "bundle", url: `/__user/bundle.js?v=${version}`, file: fileLabel, version, millis: b.millis };
      watched = new Set(b.inputs.filter((p) => !p.includes("/node_modules/")));
      if (bb) runner?.update(bb, entry);
      opts.onBuild?.({ ok: true, millis: b.millis, version, file: fileLabel });
    } catch (e) {
      const errors: BuildMessage[] = e instanceof BundleError ? e.messages : [{ message: String((e as Error)?.message ?? e) }];
      state = { type: "bundle-error", errors };
      if (runner) publishDiagnostics(DiagnosticsRunner.fromBuild(errors, root, entry));
      opts.onBuild?.({ ok: false, errors });
    }
    broadcast(state);
  }

  const assetResponse = (a: Asset) => new Response(a.body as BodyInit, { headers: { "content-type": a.type, "cache-control": "no-cache" } });

  const server = Bun.serve<WsData>({
    port: opts.port ?? 3333,
    hostname: opts.host ?? "localhost",
    development: false,
    // Diagnostics long-polls hold a request for up to 25 s.
    idleTimeout: 60,
    fetch(req, server) {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);
      if (path === "/__eval" && evalMode === "server") {
        if (server.upgrade(req, { data: { kind: "eval" } })) return undefined;
        return new Response("expected a websocket", { status: 400 });
      }
      if (path === "/__ws") {
        if (server.upgrade(req, { data: { kind: "dev" } })) return undefined;
        return new Response("expected a websocket", { status: 400 });
      }
      const html200 = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
      if (galleryRoot) {
        if (path === "/" || path === "/index.html") return html200(galleryPage(basename(galleryRoot)));
        if (path.startsWith("/view/")) return openModel(path.slice("/view/".length)).then((ok) => (ok ? html200(page) : notFound()));
        if (path === "/__gallery") return galleryList();
        if (path.startsWith("/__thumb/")) {
          const name = path.slice("/__thumb/".length);
          if (!/^[\w.-]+\.png$/.test(name)) return notFound();
          return new Response(Bun.file(join(thumbs!.dir, name)), { headers: { "content-type": "image/png", "cache-control": "max-age=31536000, immutable" } });
        }
      }
      if (path === "/" || path === "/index.html") return html200(page);
      if (path.startsWith(APP_PREFIX)) {
        const a = app.get(path.slice(APP_PREFIX.length));
        return a ? assetResponse(a) : notFound();
      }
      if (path === "/__user/bundle.js") {
        if (!bundle) return new Response("// no bundle yet", { status: 503, headers: { "content-type": "text/javascript" } });
        return new Response(`${bundle.js}\n//# sourceMappingURL=/__user/bundle.js.map\n`, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
      }
      if (path === "/__user/bundle.js.map") {
        return bundle?.map ? new Response(bundle.map, { headers: { "content-type": "application/json", "cache-control": "no-store" } }) : notFound();
      }
      if (path === "/__status") return Response.json({ state, version, file: entry, root, evalMode, pid: process.pid });
      if (path === "/__diagnostics") {
        const since = Number(url.searchParams.get("since") ?? -1);
        const reply = () => Response.json({ file: entry, items: diagnostics, version: diagVersion, enabled: !!runner });
        if (!runner || since < diagVersion) return reply();
        // Long poll (editors without WebSocket): answer when the next set lands, or after 25 s.
        return new Promise<Response>((res) => {
          const done = () => {
            clearTimeout(t);
            diagWaiters.delete(done);
            res(reply());
          };
          const t = setTimeout(done, 25_000);
          diagWaiters.add(done);
        });
      }
      // Editors: show another model in the same server (`{ "file": "/abs/or/relative.tsx" }`).
      if (path === "/__model" && req.method === "POST") return switchModel(req);
      if (path === "/__export" && req.method === "POST") return exportModel(req);
      if (path === "/__edit" && req.method === "POST") return applyEdits(req);
      if (path.startsWith("/wasm/")) {
        const name = path.slice("/wasm/".length);
        if (!/^[\w.-]+$/.test(name)) return notFound();
        const f = Bun.file(resolve(WASM_DIR, name));
        return new Response(f, { headers: { "content-type": mime(name), "cache-control": "no-cache" } });
      }
      if (path === "/favicon.ico") return new Response(null, { status: 204 });
      return notFound();
    },
    websocket: {
      open(ws) {
        const data = ws.data as { kind: string; session?: EvalSession };
        if (data.kind === "eval") {
          data.session = new EvalSession((frame) => ws.sendBinary(frame), () => bunBundles.at(-1), root);
          return;
        }
        sockets.add(ws);
        ws.send(JSON.stringify(state));
      },
      close(ws) {
        ws.data.session?.close();
        sockets.delete(ws);
      },
      message(ws, message) {
        const session = ws.data.session;
        if (session && typeof message !== "string") session.handle(message);
      },
    },
  });

  // ── gallery mode
  const thumbs = galleryRoot ? new ThumbnailCache(galleryRoot) : undefined;
  if (thumbs) thumbs.onUpdate = (file, info) => broadcast({ type: "gallery", rel: relative(galleryRoot!, file).split("\\").join("/"), info });

  /** Show `rel` (a model under the gallery root) in the viewer. */
  async function openModel(rel: string): Promise<boolean> {
    const file = resolve(galleryRoot!, decodeURIComponent(rel));
    if (!file.startsWith(galleryRoot!) || !(await Bun.file(file).exists())) return false;
    if (file !== entry) {
      entry = file;
      fileLabel = labelOf(entry);
      await rebuild();
      addWatchers();
    }
    return true;
  }

  /** The models with whatever thumbnail is cached; missing ones are rendered in the background. */
  async function galleryList(): Promise<Response> {
    const models = discoverModels(galleryRoot!);
    const items = await Promise.all(
      models.map(async (m) => {
        const c = await thumbs!.cached(m.file);
        if (!c.info) void thumbs!.get(m.file); // queued; a `gallery` socket message announces it
        return { ...m, file: undefined, thumb: c.info ?? null };
      }),
    );
    return Response.json({ root: galleryRoot, evalMode, items });
  }

  async function switchModel(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { file?: string };
    if (!body.file) return Response.json({ error: "file is required" }, { status: 400 });
    const next = resolve(root, body.file);
    if (!(await Bun.file(next).exists())) return Response.json({ error: `no such file: ${body.file}` }, { status: 404 });
    if (next !== entry) {
      entry = next;
      fileLabel = labelOf(entry);
      await rebuild();
      addWatchers();
    }
    return Response.json({ file: entry, state });
  }

  /** Sketch drag edits from the viewer: apply them to the source files (under the root) and save. */
  async function applyEdits(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { changes?: any[] };
    const byFile = new Map<string, any[]>();
    for (const c of body.changes ?? []) {
      const loc = c.kind === "addPoint" ? c.sketch : c.loc;
      if (!loc?.file) continue;
      const file = resolve(root, String(loc.file).replace(/^file:\/\//, ""));
      if (!file.startsWith(root)) continue;
      // applyChanges finds elements by location; locations here are the file's own.
      const local = { ...loc, file };
      const fixed = c.kind === "addPoint" ? { ...c, sketch: local } : { ...c, loc: local };
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push(fixed);
    }
    let applied = 0;
    const refused: { reason: string; param?: unknown }[] = [];
    for (const [file, changes] of byFile) {
      const text = await Bun.file(file).text();
      const r = applyChanges(text, changes);
      applied += r.applied.length;
      for (const f of r.refused) refused.push({ reason: f.reason, ...(f.param ? { param: f.param } : {}) });
      if (r.applied.length) await Bun.write(file, r.source); // the watcher rebuilds
    }
    return Response.json({ applied, refused });
  }

  /** Build the current model to a file next to it (`{ format, out?, params? }`), in a subprocess. */
  async function exportModel(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { format?: string; out?: string; params?: Record<string, unknown>; file?: string };
    const format = (body.format ?? "stl").toLowerCase();
    if (!["step", "stl", "3mf", "glb", "obj", "dxf", "svg"].includes(format)) return Response.json({ error: `unknown format ${format}` }, { status: 400 });
    const file = body.file ? resolve(root, body.file) : entry;
    const out = body.out ? resolve(root, body.out) : file.replace(/\.[jt]sx?$/, "") + `.${format}`;
    const args = ["bun", resolve(SRC, "cli/index.ts"), "build", file, "-o", out, "--json"];
    for (const [k, v] of Object.entries(body.params ?? {})) args.push("-p", `${k}=${v}`);
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) return Response.json({ error: stderr.trim() || `build exited with ${code}` }, { status: 422 });
    let bytes = 0;
    try {
      bytes = JSON.parse(stdout).outputs?.[0]?.bytes ?? 0;
    } catch {
      /* fine */
    }
    return Response.json({ path: out, bytes });
  }

  if (!galleryRoot || firstModel) await rebuild();
  else state = { type: "bundle-error", errors: [{ message: "no models in this folder yet" }] };

  // Watch the model's directory; rebuild when a file the bundle used changes (debounced).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];
  const onChange = (file: string) => {
    if (!watched.has(file) && file !== entry) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 40);
  };
  const dirs = () => new Set([root, ...[...watched].map(dirname)]);
  const watchedDirs = new Set<string>();
  const addWatchers = () => {
    for (const d of [...dirs(), dirname(entry)]) {
      if (watchedDirs.has(d)) continue;
      watchedDirs.add(d);
      try {
        watchers.push(watch(d, (_ev, name) => name && onChange(resolve(d, name.toString()))));
      } catch {
        /* directory vanished */
      }
    }
  };
  addWatchers();

  // Gallery: any .tsx edit may change thumbnails (a model or something it imports): re-check them.
  if (galleryRoot) {
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      watchers.push(
        watch(galleryRoot, { recursive: true }, (_e, name) => {
          const n = String(name ?? "");
          if (!/\.(tsx?|jsx?|svg|dxf|txt|csv|json)$/.test(n) || /(^|[\\/])(node_modules|\.tscad|\.git)[\\/]/.test(n)) return;
          clearTimeout(gTimer);
          gTimer = setTimeout(() => {
            broadcast({ type: "gallery-changed" });
            for (const m of discoverModels(galleryRoot)) void thumbs!.get(m.file);
          }, 300);
        }),
      );
    } catch {
      /* no recursive watch: refresh the page to update */
    }
  }

  // Hacking on tscad itself (not installed under node_modules): live-reload the viewer too.
  if (!SRC.includes("/node_modules/") && process.env.TSCAD_SELF_RELOAD !== "0") {
    let appTimer: ReturnType<typeof setTimeout> | undefined;
    const rebuildApp = async () => {
      try {
        [app, html] = await Promise.all([buildApp(), Bun.file(resolve(SRC, "viewer/index.html")).text()]);
        page = makePage();
        broadcast({ type: "reload-viewer" });
      } catch (e) {
        console.error(String((e as Error)?.message ?? e));
      }
    };
    for (const d of ["viewer", "core", "kernel", "export"]) {
      try {
        watchers.push(watch(resolve(SRC, d), { recursive: true }, () => {
          clearTimeout(appTimer);
          appTimer = setTimeout(rebuildApp, 80);
        }));
      } catch {
        /* missing */
      }
    }
  }
  const origOnBuild = opts.onBuild;
  opts.onBuild = (e) => {
    addWatchers();
    origOnBuild?.(e);
  };

  const port = server.port!;
  const url = `http://${opts.host && opts.host !== "0.0.0.0" ? opts.host : "localhost"}:${port}`;

  // Editors find a running server for a folder through this file (removed on stop).
  const discovery = join(tmpdir(), `tscad-dev-${createHash("sha1").update(root).digest("hex").slice(0, 12)}.json`);
  try {
    writeFileSync(discovery, JSON.stringify({ pid: process.pid, url, root, file: entry }));
  } catch {
    /* read-only tmp: no discovery */
  }

  return {
    url,
    port,
    server,
    evalMode,
    nativeKernel: await hasNativeKernel(),
    rebuild,
    async stop() {
      clearTimeout(timer);
      for (const b of bunBundles) rmSync(b.path, { force: true });
      runner?.dispose();
      rmSync(discovery, { force: true });
      for (const w of watchers) w.close();
      for (const ws of sockets) ws.close();
      await server.stop(true);
    },
  };
}

function notFound() {
  return new Response("not found", { status: 404 });
}

/** Per-socket data of the dev server. */
export interface WsData {
  kind: string;
  session?: EvalSession;
}

async function hasNativeKernel(): Promise<boolean> {
  try {
    return !((await loadKernel()) instanceof WasmKernelHost);
  } catch {
    return false;
  }
}

/** Server-side evaluation needs the native kernel (that's the point: ~2× the wasm). */
async function chooseEvalMode(want: "auto" | "server" | "browser"): Promise<"server" | "browser"> {
  if (want === "browser") return "browser";
  if (want === "server") return "server";
  try {
    const k = await loadKernel();
    return k instanceof WasmKernelHost ? "browser" : "server";
  } catch {
    return "browser";
  }
}

/** The gallery page: the app's styles, and the gallery script (src/viewer/gallery.ts). */
function galleryPage(title: string): string {
  return `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&]/g, "")} · tscad</title>
<link rel="stylesheet" href="${APP_PREFIX}viewer/styles.css">
<script>try { document.documentElement.dataset.theme = localStorage.getItem("tscad.theme") || "dark" } catch {}</script>
</head><body><div id="gallery"></div><script type="module" src="${APP_PREFIX}viewer/gallery.js"></script></body></html>`;
}
