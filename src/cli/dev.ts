/**
 * `tscad dev`: a Bun.serve dev server. Serves the viewer app, the kernel wasm and the user's model
 * bundle; watches the model (and its local imports) and pushes reloads over a WebSocket.
 */
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { APP_PREFIX, type Asset, buildApp, buildUser, BundleError, type BuildMessage, mime, SRC, WASM_DIR } from "./bundle";

export interface DevOptions {
  file: string;
  port?: number;
  host?: string;
  /** Called on every rebuild (for logging). */
  onBuild?: (e: { ok: true; millis: number; version: number } | { ok: false; errors: BuildMessage[] }) => void;
  quiet?: boolean;
}

export interface DevServer {
  url: string;
  port: number;
  server: Server<unknown>;
  rebuild(): Promise<void>;
  stop(): Promise<void>;
}

type State =
  | { type: "bundle"; url: string; file: string; version: number; millis: number }
  | { type: "bundle-error"; errors: BuildMessage[] }
  | { type: "building" };

export async function startDev(opts: DevOptions): Promise<DevServer> {
  const entry = resolve(opts.file);
  const root = dirname(entry);
  const fromCwd = relative(process.cwd(), entry);
  const fileLabel = fromCwd && !fromCwd.startsWith("..") ? fromCwd : basename(entry);

  let [app, html] = await Promise.all([buildApp(), Bun.file(resolve(SRC, "viewer/index.html")).text()]);
  const makePage = () => html.replace(
    "<!--TSCAD_CONFIG-->",
    `<script>window.__TSCAD__ = ${JSON.stringify({ file: fileLabel, ws: "/__ws", wasmUrl: "/wasm/tscad_wasm_bg.wasm", glueUrl: "/wasm/tscad_wasm.js", workerUrl: `${APP_PREFIX}viewer/worker.js` })};</script>`,
  );
  let page = makePage();

  let version = 0;
  let bundle: { js: string; map?: string } | undefined;
  let state: State = { type: "building" };
  let watched = new Set<string>();

  const sockets = new Set<ServerWebSocket<unknown>>();
  const broadcast = (msg: State | { type: string }) => {
    const text = JSON.stringify(msg);
    for (const ws of sockets) ws.send(text);
  };

  async function rebuild() {
    broadcast({ type: "building" });
    try {
      const b = await buildUser(entry, root);
      bundle = b;
      version++;
      state = { type: "bundle", url: `/__user/bundle.js?v=${version}`, file: fileLabel, version, millis: b.millis };
      watched = new Set(b.inputs.filter((p) => !p.includes("/node_modules/")));
      opts.onBuild?.({ ok: true, millis: b.millis, version });
    } catch (e) {
      const errors: BuildMessage[] = e instanceof BundleError ? e.messages : [{ message: String((e as Error)?.message ?? e) }];
      state = { type: "bundle-error", errors };
      opts.onBuild?.({ ok: false, errors });
    }
    broadcast(state);
  }

  const assetResponse = (a: Asset) => new Response(a.body as BodyInit, { headers: { "content-type": a.type, "cache-control": "no-cache" } });

  const server = Bun.serve({
    port: opts.port ?? 3333,
    hostname: opts.host ?? "localhost",
    development: false,
    fetch(req, server) {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);
      if (path === "/__ws") {
        if (server.upgrade(req)) return undefined;
        return new Response("expected a websocket", { status: 400 });
      }
      if (path === "/" || path === "/index.html") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
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
      if (path === "/__status") return Response.json({ state, version });
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
        sockets.add(ws);
        ws.send(JSON.stringify(state));
      },
      close(ws) {
        sockets.delete(ws);
      },
      message() {},
    },
  });

  await rebuild();

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
    for (const d of dirs()) {
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

  // Hacking on tscad itself (not installed under node_modules): live-reload the viewer too.
  if (!SRC.includes("/node_modules/")) {
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
  return {
    url: `http://${opts.host && opts.host !== "0.0.0.0" ? opts.host : "localhost"}:${port}`,
    port,
    server,
    rebuild,
    async stop() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
      for (const ws of sockets) ws.close();
      await server.stop(true);
    },
  };
}

function notFound() {
  return new Response("not found", { status: 404 });
}
