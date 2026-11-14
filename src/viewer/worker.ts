/// <reference lib="webworker" />
/**
 * The eval worker: imports the user's bundled module, renders it with the current params,
 * evaluates it with the kernel and posts meshes back as transferables. Param changes re-run
 * here only (latest wins). No server-only APIs: a static playground can host this file as is.
 */
import { loadKernel, type KernelHost, KernelPanic } from "../kernel";
import { renderModule } from "../index";
import { exportModel } from "../export";
import type { Document, PartResult } from "../ir";
import type { EvalData, FromWorker, Loc, ParamSchemaData, ParamValuesData, PartData, StageError, ToWorker } from "./protocol";
import { codeFrame, parseStack, SourceMap, stripQuery } from "./sourcemap";
import type { DrawingData } from "./protocol";
import { flattenNurbs } from "../drawing/common";
import { polylineLoops, section, toDXF, toSVG } from "../drawing";

declare const self: DedicatedWorkerGlobalScope;

let kernel: Promise<KernelHost> | undefined;
let mod: any;
let modUrl = "";
let sourceMap: Promise<SourceMap | undefined> | undefined;
let values: ParamValuesData = {};
let lastSchema: ParamSchemaData = {};
let pending = false;
let running = false;
let seq = 0;
let lastDrawings: any[] = [];
let lastBoxes = new Map<string, PartData["bbox"]>();

/** DXF/SVG: the model's `<drawing>`s, else the parts cut at mid-height. */
async function export2D(k: KernelHost, parts: { name: string }[], format: "dxf" | "svg"): Promise<string> {
  let layers: { name: string; loops: any[] }[] = lastDrawings;
  if (!layers.length) {
    const boxes = parts.map((p) => lastBoxes.get(p.name)).filter((b) => !!b);
    const z = (Math.min(...boxes.map((b) => b![0][2])) + Math.max(...boxes.map((b) => b![1][2]))) / 2;
    layers = [];
    for (const p of parts) layers.push({ name: p.name, loops: polylineLoops(section(await k.meshAt(p.name, 0.01), { origin: [0, 0, z], normal: [0, 0, 1] }).loops) });
  }
  return format === "dxf" ? toDXF(layers as any) : toSVG(layers as any);
}

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init": {
        const t = performance.now();
        kernel = loadKernel(msg.wasmUrl, msg.glueUrl);
        const k = await kernel;
        post({ type: "ready", version: k.version, loadMs: performance.now() - t });
        break;
      }
      case "load": {
        post({ type: "busy", stage: "loading" });
        const url = new URL(msg.url, self.location.href).href;
        try {
          const next = await import(/* @vite-ignore */ url);
          mod = next;
          modUrl = url;
          sourceMap = msg.map ? Promise.resolve(new SourceMap(msg.map as any)) : undefined;
        } catch (err) {
          modUrl = url;
          sourceMap = msg.map ? Promise.resolve(new SourceMap(msg.map as any)) : undefined;
          post({ type: "error", error: await stageError("import", err) });
          break;
        }
        if (msg.values) values = msg.values;
        schedule();
        break;
      }
      case "params":
        values = msg.values;
        schedule();
        break;
      case "pick": {
        const k = await requireKernel();
        try {
          const info = msg.kind === "edge" ? await k.pickEdge(msg.part, msg.index) : await k.pickFace(msg.part, msg.index);
          post({ type: "pick", id: msg.id, info });
        } catch (err) {
          post({ type: "pick", id: msg.id, error: String((err as Error)?.message ?? err) });
        }
        break;
      }
      case "export": {
        const k = await requireKernel();
        try {
          const data =
            msg.format === "dxf" || msg.format === "svg"
              ? await export2D(k, msg.parts, msg.format)
              : await exportModel(k, msg.parts, msg.format, { tolerance: msg.tolerance });
          post({ type: "export", id: msg.id, data }, typeof data === "string" ? [] : [data.buffer as ArrayBuffer]);
        } catch (err) {
          post({ type: "export", id: msg.id, error: String((err as Error)?.message ?? err) });
        }
        break;
      }
    }
  } catch (err) {
    post({ type: "error", error: await stageError("worker", err) });
  }
};

function requireKernel(): Promise<KernelHost> {
  if (!kernel) throw new Error("kernel not initialised");
  return kernel;
}

/** Run once now, and once more after the current run if params changed meanwhile. */
function schedule() {
  pending = true;
  if (running) return;
  // Let queued messages (e.g. a burst of slider moves) land before running: latest wins.
  setTimeout(drain, 0);
  running = true;
}

async function drain() {
  try {
    while (pending) {
      pending = false;
      await run();
      // Yield so messages that arrived during the run are applied first.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    running = false;
  }
}

async function run() {
  if (!mod) return;
  const k = await requireKernel();
  const t0 = performance.now();
  post({ type: "busy", stage: "rendering" });
  let rendered: { document: Document; sourceMap: Record<string, unknown>; params: ParamSchemaData; values: ParamValuesData; [k: string]: unknown };
  try {
    rendered = (await renderModule(mod, values)) as any;
  } catch (err) {
    post({ type: "error", error: await stageError("render", err), schema: schemaOf(mod), values });
    return;
  }
  const t1 = performance.now();
  post({ type: "busy", stage: "evaluating" });
  let result;
  try {
    result = await k.evaluate(rendered.document);
  } catch (err) {
    const error = await stageError("kernel", err);
    if (err instanceof KernelPanic) error.message = `${error.message}\n(the kernel was restarted; this is a solidcore bug, not your model)`;
    post({ type: "error", error, schema: rendered.params, values: rendered.values });
    return;
  }
  const t2 = performance.now();
  const transfer: Transferable[] = [];
  const parts: PartData[] = [];
  const docParts = rendered.document.parts ?? [];
  for (let i = 0; i < result.parts.length; i++) {
    const r = result.parts[i]!;
    const p = docParts[i] ?? docParts.find((d) => d.name === r.name);
    const meta = partMeta(rendered, r.name, p as any);
    const data: PartData = {
      name: r.name,
      color: p?.color,
      ok: r.ok,
      empty: r.empty,
      volume: r.volume,
      area: r.area,
      bbox: r.bbox,
      counts: r.counts,
      warnings: r.warnings,
      millis: r.millis,
      cached: r.cached,
      ...meta,
    };
    if (r.error) data.error = { ...r.error, ...(await errorLoc(r, rendered.sourceMap)) };
    if (r.ok && !r.empty) {
      const m = await k.mesh(r.name);
      if (m) {
        data.mesh = m;
        for (const a of Object.values(m)) transfer.push((a as ArrayBufferView).buffer as ArrayBuffer);
      }
    }
    parts.push(data);
  }
  const drawings: DrawingData[] = [];
  for (const d of (rendered.drawings as any[] | undefined) ?? []) {
    if (d.thickness) continue; // already a part
    const segments = drawingSegments(d.loops);
    drawings.push({ name: d.name, color: d.color, loops: d.loops.length, segments });
    transfer.push(segments.buffer as ArrayBuffer);
  }
  const t3 = performance.now();
  lastSchema = rendered.params ?? {};
  lastDrawings = (rendered.drawings as any[] | undefined) ?? [];
  lastBoxes = new Map(parts.map((p) => [p.name, p.bbox]));
  const data: EvalData = {
    parts,
    drawings,
    schema: lastSchema,
    values: rendered.values ?? values,
    warnings: (rendered.warnings as string[]) ?? [],
    cacheHits: result.cacheHits,
    cacheMisses: result.cacheMisses,
    timings: { render: t1 - t0, kernel: t2 - t1, mesh: t3 - t2, total: t3 - t0 },
    seq: ++seq,
  };
  post({ type: "result", data }, transfer);
}

/** 2D loops (lines, arcs, NURBS) → line segments on z = 0. */
function drawingSegments(loops: any[][]): Float32Array {
  const out: number[] = [];
  const push = (pts: [number, number][]) => {
    for (let i = 0; i + 1 < pts.length; i++) out.push(pts[i]![0], pts[i]![1], 0, pts[i + 1]![0], pts[i + 1]![1], 0);
  };
  for (const loop of loops) {
    for (const s of loop) {
      if (s.kind === "line") push([s.a, s.b]);
      else if (s.kind === "arc") {
        const n = Math.max(8, Math.ceil((Math.abs(s.a1 - s.a0) / (Math.PI * 2)) * 96));
        push(Array.from({ length: n + 1 }, (_, i) => {
          const t = s.a0 + ((s.a1 - s.a0) * i) / n;
          return [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)] as [number, number];
        }));
      } else if (s.kind === "nurbs") push(flattenNurbs(s, 0.02) as [number, number][]);
    }
  }
  return new Float32Array(out);
}

function schemaOf(m: any): ParamSchemaData {
  const p = m?.params;
  if (p && typeof p === "object") return (p.schema ?? p) as ParamSchemaData;
  return lastSchema;
}

/** Material/density of a part, wherever the core put it. */
function partMeta(rendered: any, name: string, part: any): { density?: number; material?: string } {
  const list = Array.isArray(rendered.parts) ? rendered.parts : [];
  const meta = list.find((p: any) => p?.name === name) ?? part ?? {};
  const out: { density?: number; material?: string } = {};
  const density = meta.density ?? meta.material?.density;
  if (typeof density === "number") out.density = density;
  const material = typeof meta.material === "string" ? meta.material : meta.material?.name;
  if (typeof material === "string") out.material = material;
  return out;
}

/** Where a kernel error's node came from: the nearest recorded ancestor path. */
async function errorLoc(r: PartResult, map: Record<string, unknown>): Promise<{ loc?: Loc; frame?: any }> {
  if (!r.error || !map) return {};
  let path = r.error.path;
  while (path) {
    const raw = map[path];
    if (raw) return locate(normalizeLoc(raw));
    const cut = path.lastIndexOf("/");
    if (cut < 0) break;
    path = path.slice(0, cut);
  }
  return {};
}

function normalizeLoc(raw: any): Loc | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const file = raw.fileName ?? raw.file ?? raw.source;
  const line = raw.lineNumber ?? raw.line;
  const column = (raw.columnNumber ?? raw.column ?? 1) || 1;
  if (typeof file !== "string" || typeof line !== "number") return undefined;
  return { file, line, column };
}

async function getSourceMap(): Promise<SourceMap | undefined> {
  if (!modUrl) return undefined;
  sourceMap ??= fetch(`${stripQuery(modUrl)}.map`)
    .then((r) => (r.ok ? r.json() : undefined))
    .then((raw) => (raw ? new SourceMap(raw) : undefined))
    .catch(() => undefined);
  return sourceMap;
}

const isBundle = (file: string) => !!modUrl && stripQuery(file) === stripQuery(modUrl);

/** Map a bundle position to TSX and attach a code frame. */
async function locate(loc: Loc | undefined): Promise<{ loc?: Loc; frame?: any }> {
  if (!loc) return {};
  const map = await getSourceMap();
  if (map && isBundle(loc.file)) {
    const orig = map.lookup(loc.line, loc.column);
    if (orig) {
      const text = map.content(orig.file);
      return { loc: orig, frame: text ? codeFrame(text, orig) : undefined };
    }
  }
  if (map) {
    const text = map.content(loc.file);
    if (text) return { loc, frame: codeFrame(text, loc) };
  }
  return { loc };
}

async function stageError(stage: StageError["stage"], err: unknown): Promise<StageError> {
  const e = err as any;
  const message = e?.message ? String(e.message) : String(err);
  const stack = typeof e?.stack === "string" ? e.stack : undefined;
  const out: StageError = { stage, message, stack };
  // The first frame inside the user's bundle is the line to blame.
  // A TscadError knows its element; otherwise blame the first frame in the user's bundle.
  const where = normalizeLoc(e?.loc) ?? parseStack(stack).find((f) => isBundle(f.file));
  if (typeof e?.detail === "string") out.message = e.detail + (e.hint ? `\nhint: ${e.hint}` : "");
  if (where) Object.assign(out, await locate(where));
  if (out.loc || !stack) return out;
  return out;
}
