/**
 * Project gallery: find every model in a folder tree, describe it from its doc comment, and keep
 * a thumbnail of each on disk (`.tscad/cache/`), rendered in background subprocesses keyed by
 * the content of every file the model imports. Used by `tscad dev <dir>` and `tscad render <dir>`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { buildUser, SRC } from "./bundle";
import pkg from "../../package.json" with { type: "json" };

const SKIP_DIRS = new Set(["node_modules", ".git", ".tscad", "dist", "out", "build", "target", "coverage"]);

/** A model: a .tsx that default-exports and imports tscad (or uses its elements). Test and spec files aren't models. */
export function isModelSource(name: string, text: string): boolean {
  if (!/\.tsx$/.test(name) || /\.(test|spec)\.tsx$/.test(name)) return false;
  if (!/^\s*export\s+default\b/m.test(text)) return false;
  // Imports tscad, or (relying on jsxImportSource alone) uses its top-level elements.
  return /^\s*import\s(?:[^;]*?from\s*)?["']tscad(?:\/[\w-]+)?["']/m.test(text) || /<(part|assembly|drawing|box|cylinder|sphere|cone|torus|extrude|revolve|loft|sweep|union|difference|intersection)[\s/>]/.test(text);
}

/** A model found by the gallery: its file and what it describes. */
export interface ModelEntry {
  /** Absolute path. */
  file: string;
  /** Relative to the gallery root, with forward slashes. */
  rel: string;
  title: string;
  description: string;
  mtime: number;
}

/** Every model under `root` (skipping node_modules, dot-dirs and build output), sorted by path. */
export function discoverModels(root: string): ModelEntry[] {
  const out: ModelEntry[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(n) && !n.startsWith(".")) walk(p);
        continue;
      }
      if (!n.endsWith(".tsx")) continue;
      const text = readFileSync(p, "utf8");
      if (!isModelSource(n, text)) continue;
      const d = describeModel(n.replace(/\.tsx$/, ""), text);
      out.push({ file: p, rel: relative(root, p).split("\\").join("/"), title: d.title, description: d.description, mtime: st.mtimeMs });
    }
  };
  walk(resolve(root));
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Title and description from a model's leading doc comment ("Title: description…"). */
export function describeModel(name: string, source: string): { title: string; description: string } {
  const doc = source.match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1] ?? "";
  const text = doc
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .filter((l) => l.trim() && !/^\s{2,}(bunx\s+)?tscad /.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = text.split(/(?<=[.:—])\s/)[0] ?? "";
  const cut = text.match(/^(.{3,60}?)(?::| — |, )/);
  const title = (cut?.[1] ?? (name.replace(/[-_]+/g, " ") || "model")).replace(/^"|"$/g, "").replace(/`/g, "").trim();
  return { title: title.charAt(0).toUpperCase() + title.slice(1), description: (cut ? text.slice(cut[0].length) : text ? firstSentence : "").trim().split(/(?<=\.)\s/)[0] ?? "" };
}

/**
 * Cache key of a model's thumbnail: tscad's version, the render settings and the content of
 * every local file the model imports (so editing a component re-renders its users).
 */
export async function thumbnailKey(file: string, settings: Record<string, unknown> = {}): Promise<string> {
  const h = createHash("sha1").update(`${pkg.version}\n${JSON.stringify(settings)}\n`);
  let inputs = [file];
  try {
    inputs = (await buildUser(file)).inputs.sort();
  } catch {
    // Doesn't bundle: key on the file itself (the error is the thumbnail).
  }
  for (const f of inputs) {
    try {
      h.update(f).update(readFileSync(f));
    } catch {
      h.update(`${f}:missing`);
    }
  }
  return h.digest("hex").slice(0, 20);
}

/** What a thumbnail render found out about the model (stored next to the PNG). */
export interface ThumbInfo {
  ok: boolean;
  parts: number;
  volume: number;
  error?: string;
  millis: number;
  /** The PNG file name in the cache dir (absent when the model failed). */
  png?: string;
  renderedAt: number;
}

/** Thumbnail rendering options. */
export interface ThumbOptions {
  width?: number;
  height?: number;
  view?: string;
  background?: string;
}

/** Thumbnails for one root, rendered by `tscad render` subprocesses (`concurrency` at a time). */
export class ThumbnailCache {
  readonly dir: string;
  #queue: { file: string; resolve: (i: ThumbInfo) => void }[] = [];
  #running = 0;
  #inflight = new Map<string, Promise<ThumbInfo>>();
  /** Called whenever a thumbnail is (re)rendered. */
  onUpdate: (file: string, info: ThumbInfo) => void = () => {};

  constructor(
    readonly root: string,
    readonly opts: ThumbOptions & { concurrency?: number; cacheDir?: string } = {},
  ) {
    this.dir = opts.cacheDir ?? join(root, ".tscad", "cache");
  }

  get settings() {
    return { w: this.opts.width ?? 480, h: this.opts.height ?? 320, view: this.opts.view ?? "iso", bg: this.opts.background ?? "dark" };
  }

  /** The cached result for `file` as it is now, if any (never renders). */
  async cached(file: string): Promise<{ key: string; info?: ThumbInfo }> {
    const key = await thumbnailKey(file, this.settings);
    const meta = join(this.dir, `${key}.json`);
    if (!existsSync(meta)) return { key };
    try {
      return { key, info: JSON.parse(readFileSync(meta, "utf8")) };
    } catch {
      return { key };
    }
  }

  /** The thumbnail for `file`: from the cache, or rendered (queued behind others). */
  async get(file: string): Promise<ThumbInfo> {
    const c = await this.cached(file);
    if (c.info) return c.info;
    const running = this.#inflight.get(c.key);
    if (running) return running;
    const p = new Promise<ThumbInfo>((resolve) => {
      this.#queue.push({ file, resolve });
      this.#pump();
    });
    this.#inflight.set(c.key, p);
    p.finally(() => this.#inflight.delete(c.key));
    return p;
  }

  #pump() {
    const max = this.opts.concurrency ?? Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
    while (this.#running < max && this.#queue.length) {
      const job = this.#queue.shift()!;
      this.#running++;
      this.#render(job.file)
        .then((info) => {
          job.resolve(info);
          this.onUpdate(job.file, info);
        })
        .finally(() => {
          this.#running--;
          this.#pump();
        });
    }
  }

  async #render(file: string): Promise<ThumbInfo> {
    mkdirSync(this.dir, { recursive: true });
    // Key computed before rendering: an edit during the render makes a new key, rendered next time.
    const key = await thumbnailKey(file, this.settings);
    const png = `${key}.png`;
    const s = this.settings;
    const t = performance.now();
    const proc = Bun.spawn(
      ["bun", join(SRC, "cli/index.ts"), "render", file, "-o", join(this.dir, png), "--width", String(s.w), "--height", String(s.h), "--view", s.view, "--background", s.bg, "--json"],
      // One kernel per render: the parallelism is several renders at once.
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", TSCAD_PARALLEL: "0" } },
    );
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    let info: ThumbInfo;
    try {
      const j = JSON.parse(stdout) as { parts: { ok: boolean; volume?: number }[] };
      const ok = code === 0;
      info = {
        ok,
        parts: j.parts.length,
        volume: j.parts.reduce((s, p) => s + (p.ok ? (p.volume ?? 0) : 0), 0),
        ...(ok ? { png } : { error: firstError(stderr) }),
        millis: performance.now() - t,
        renderedAt: Date.now(),
      };
      if (!ok && existsSync(join(this.dir, png))) info.png = png; // partial: some parts rendered
    } catch {
      info = { ok: false, parts: 0, volume: 0, error: firstError(stderr) || `render exited with ${code}`, millis: performance.now() - t, renderedAt: Date.now() };
    }
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(info));
    return info;
  }
}

function firstError(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.find((l) => /^(x |✗ |Error|TscadError|SyntaxError)/.test(l)) ?? lines[0] ?? "failed").replace(/^(x|✗) /, "").slice(0, 300);
}

/** `tscad render <dir> --out <dir>`: every model in `dir` to `<out>/<relative path>.png`. */
export async function renderAll(opts: { dir: string; out: string; width?: number; height?: number; view?: string; background?: string; concurrency?: number; log?: (line: string) => void }): Promise<{ file: string; png?: string; info: ThumbInfo }[]> {
  const root = resolve(opts.dir);
  const models = discoverModels(root);
  const out = resolve(opts.out);
  const results: { file: string; png?: string; info: ThumbInfo }[] = [];
  // Render through a private cache (so reruns skip unchanged models), then copy to `out`.
  const cache = new ThumbnailCache(root, { width: opts.width ?? 1200, height: opts.height ?? 800, view: opts.view, background: opts.background, concurrency: opts.concurrency, cacheDir: join(root, ".tscad", "cache", "render") });
  await Promise.all(
    models.map(async (m) => {
      const info = await cache.get(m.file);
      let png: string | undefined;
      if (info.png) {
        png = join(out, m.rel.replace(/\.tsx$/, ".png"));
        mkdirSync(resolve(png, ".."), { recursive: true });
        writeFileSync(png, readFileSync(join(cache.dir, info.png)));
      }
      opts.log?.(`${info.ok ? "ok" : "x "} ${m.rel}${info.error ? ` — ${info.error}` : ""}`);
      results.push({ file: m.file, png, info });
    }),
  );
  return results.sort((a, b) => a.file.localeCompare(b.file));
}

