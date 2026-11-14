/// <reference lib="webworker" />
/**
 * The eval worker: imports the user's bundled module, renders it with the current params,
 * evaluates it with the kernel and posts meshes back as transferables. Param changes re-run
 * here only (latest wins). No server-only APIs: a static playground can host this file as is.
 */
import { loadKernel, type KernelHost, KernelPanic, WasmKernelHost } from "../kernel";
import { dragSolve, renderModule } from "../index";
import { toGLB, toOBJ, toSTL, to3MF, type ExportPart } from "../export";
import { ChildEvaluator, LocalEvaluator, Pool, serveChild } from "./pool";
import { checkInterference, checkPrintability } from "../check";
import type { InterferenceData, PrintabilityData } from "./protocol";
import type { Document, PartResult } from "../ir";
import type { EvalData, FromWorker, Loc, ParamSchemaData, ParamValuesData, PartData, StageError, ToWorker } from "./protocol";
import { codeFrame, parseStack, SourceMap, stripQuery } from "./sourcemap";
import type { AssemblyData, DiffData, DrawingData, MateData, SketchData } from "./protocol";
import { diffDocument, summarize, type PartStats } from "./diff";
import { orientationNote, plate3MF, plateParts, transformMesh } from "../plate";
import type { PlateData } from "./protocol";
import { flattenNurbs } from "../drawing/common";
import { polylineLoops, section, toDXF, toSVG } from "../drawing";

declare const self: DedicatedWorkerGlobalScope;

let kernel: Promise<KernelHost> | undefined;
let pool: Pool | undefined;
let lastDoc: Document | undefined;
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

// ── geometry diff (only computed while the viewer's diff mode is on)
interface Snapshot {
  doc: Document;
  stats: Map<string, PartStats>;
  values: ParamValuesData;
  seq: number;
}
let diffOn = false;
/** The last render as core returned it (raw source locations), for sketch drags. */
let lastRaw: any;
const sameRawLoc = (a: any, b: any) => !!a && !!b && a.file === b.file && a.line === b.line && a.column === b.column;
let pinned: Snapshot | undefined;
let previous: Snapshot | undefined;
let current: Snapshot | undefined;

/** Diff `current` against the pinned snapshot or the previous one; dropped if a newer run is queued. */
async function runDiff() {
  if (!diffOn || !current || !pool) return;
  const base = pinned ?? previous;
  const cur = current;
  const t0 = performance.now();
  if (!base) return post({ type: "diff", data: { seq: cur.seq, baseline: "none", parts: [], meshes: [], millis: 0 } });
  const { document, entries } = diffDocument(base.doc, cur.doc);
  let results = new Map<string, any>();
  let meshes = new Map<string, import("../kernel").MeshArrays>();
  if (document.parts?.length) {
    if (pending) return; // a newer evaluation is coming: this diff would be stale
    try {
      const r = await pool.evaluate(document);
      results = new Map(r.result.parts.map((p) => [p.name, p]));
      meshes = r.meshes;
    } finally {
      // The kernels now hold the diff solids: give them the model back (cached, so cheap).
      if (lastDoc) await pool.evaluate(lastDoc);
    }
    if (pending || current !== cur) return;
  }
  const parts = summarize(entries, results, base.stats, cur.stats);
  const out: DiffData["meshes"] = [];
  const transfer: Transferable[] = [];
  for (const e of entries) {
    const added = e.added ? meshes.get(e.added) : undefined;
    const removed = e.removed ? meshes.get(e.removed) : undefined;
    if (!added && !removed) continue;
    out.push({ part: e.part, added, removed });
    for (const m of [added, removed]) if (m) for (const a of Object.values(m)) transfer.push((a as ArrayBufferView).buffer as ArrayBuffer);
  }
  post({ type: "diff", data: { seq: cur.seq, baseline: pinned ? "pinned" : "previous", baselineValues: pinned?.values, parts, meshes: out, millis: performance.now() - t0 } }, transfer);
}

/** DXF/SVG: the model's `<drawing>`s, else the parts cut at mid-height. */
async function export2D(k: Pool, parts: { name: string }[], format: "dxf" | "svg"): Promise<string> {
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

self.onmessage = async (e: MessageEvent<ToWorker | { type: "child-init"; module?: WebAssembly.Module; glueUrl: string }>) => {
  const msg = e.data;
  // A nested kernel worker (see pool.ts): from now on it only serves evaluate/pick/mesh/step.
  if (msg.type === "child-init") return serveChild(self, msg.module, msg.glueUrl);
  try {
    switch (msg.type) {
      case "init": {
        const t = performance.now();
        if (msg.native) {
          // Server-side (a bun Worker in `tscad dev`): the default kernel, native when built.
          kernel = loadKernel();
          const k = await kernel;
          const isNative = !(k instanceof WasmKernelHost);
          // The native kernel serialises every op behind one process-global lock, so parts run in
          // parallel in kernel *processes* (src/cli/parallel.ts), bun only.
          let size = 1;
          let spawn: () => import("./pool").Evaluator = () => {
            throw new Error("no parallel kernels");
          };
          if (isNative) {
            const par = await import("../cli/parallel");
            size = Math.max(1, Math.min(4, msg.pool ?? par.defaultParallelism()));
            spawn = () => {
              const p = new par.ProcessEvaluator();
              void p.warm().catch(() => {});
              return p;
            };
          }
          pool = new Pool(new LocalEvaluator(k), size, spawn);
          post({ type: "ready", version: k.version, loadMs: performance.now() - t, pool: size, native: isNative });
          break;
        }
        const wasm = new URL(msg.wasmUrl, self.location.href);
        const res = await fetch(wasm);
        const module = await WebAssembly.compile(await res.arrayBuffer());
        kernel = loadKernel(module, msg.glueUrl);
        const k = await kernel;
        const cores = (self.navigator as any)?.hardwareConcurrency ?? 2;
        const size = Math.max(1, Math.min(4, msg.pool ?? cores - 1));
        pool = new Pool(new LocalEvaluator(k), size, () => new ChildEvaluator(self.location.href, module, msg.glueUrl));
        post({ type: "ready", version: k.version, loadMs: performance.now() - t, pool: size });
        break;
      }
      case "load": {
        post({ type: "busy", stage: "loading" });
        const url = new URL(msg.url, self.location?.href ?? "file:///").href;
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
      case "diff":
        diffOn = msg.on;
        if (diffOn) void runDiff();
        break;
      case "diff-pin":
        pinned = msg.pin ? current : undefined;
        if (diffOn) void runDiff();
        break;
      case "plate": {
        try {
          if (!lastDoc || !pool) throw new Error("no model yet");
          const parts = [];
          const colors = new Map((lastDoc.parts ?? []).map((p) => [p.name ?? "", p.color]));
          for (const [name, st] of current?.stats ?? []) {
            if (st.volume === undefined) continue; // failed or empty
            parts.push({ name, color: colors.get(name), mesh: await pool.meshAt(name, msg.download ? 0.01 : 0.05), copies: msg.copies?.[name] ?? 1 });
          }
          const r = plateParts(parts, { bed: msg.bed, spacing: msg.spacing, orient: msg.orient });
          const result: PlateData = {
            plates: r.plates,
            bed: r.bed,
            items: r.items.map((it) => ({ name: it.name, copy: it.copy, plate: it.plate, transform: it.transform, bottom: it.orientation.label, overhang: it.orientation.overhangFraction, overhangArea: it.orientation.overhangArea, height: it.orientation.height, rect: it.rect, rotated90: it.rotated90 })),
          };
          let files: Uint8Array[] | undefined;
          if (msg.download) {
            const meshes = new Map(parts.map((p) => [p.name, p.mesh]));
            files = [];
            for (let n = 0; n < r.plates; n++) {
              const on = r.items.filter((it) => it.plate === n);
              const many = (name: string) => (msg.copies?.[name] ?? 1) > 1;
              files.push(plate3MF(on.map((it) => ({ name: many(it.name) ? `${it.name} #${it.copy}` : it.name, color: it.color, mesh: transformMesh(meshes.get(it.name)!, it.transform) })), on.map(orientationNote), r.bed));
            }
          }
          post({ type: "plate", id: msg.id, result, files }, (files ?? []).map((f) => f.buffer as ArrayBuffer));
        } catch (err) {
          post({ type: "plate", id: msg.id, error: String((err as Error)?.message ?? err) });
        }
        break;
      }
      case "sketch-drag": {
        try {
          const raw = lastRaw?.sketches?.[msg.sketch];
          if (!raw?.loc) throw new Error("that sketch has no source location");
          const occurrence = (lastRaw!.sketches as any[]).slice(0, msg.sketch).filter((s) => sameRawLoc(s.loc, raw.loc)).length;
          const d: any = dragSolve(mod, lastRaw!.values ?? values, { sketch: raw.loc, occurrence, point: msg.point, target: msg.target, changeDimensions: msg.changeDimensions });
          const mapLoc = async (l: any) => (await locate(normalizeLoc(l))).loc;
          const changes = [];
          for (const c of d.changes ?? []) changes.push(c.kind === "prop" ? { ...c, loc: await mapLoc(c.loc) } : { ...c, sketch: await mapLoc(c.sketch) });
          const blockedBy = [];
          for (const b of d.blockedBy ?? []) blockedBy.push({ ...b, loc: b.loc ? await mapLoc(b.loc) : undefined });
          post({ type: "sketch-drag", id: msg.id, result: { reached: d.reached, points: d.points, entities: d.entities, blockedBy, changes } });
        } catch (err) {
          post({ type: "sketch-drag", id: msg.id, error: String((err as Error)?.message ?? err) });
        }
        break;
      }
      case "dispose":
        pool?.dispose();
        break;
      case "pick": {
        await requireKernel();
        try {
          const info = await pool!.pick(msg.kind, msg.part, msg.index);
          post({ type: "pick", id: msg.id, info });
        } catch (err) {
          post({ type: "pick", id: msg.id, error: String((err as Error)?.message ?? err) });
        }
        break;
      }
      case "check": {
        const k = await requireKernel();
        try {
          if (msg.kind === "printability") {
            const out: PrintabilityData[] = [];
            const transfer: Transferable[] = [];
            for (const m of msg.parts) {
              const r = checkPrintability(m, { maxOverhangDeg: msg.maxOverhangDeg, minWall: msg.minWall, skipThickness: !msg.thickness });
              const d: PrintabilityData = {
                name: m.name,
                severity: r.overhang.severity,
                overhangArea: r.overhang.area,
                overhangFraction: r.overhang.fraction,
                warnings: r.warnings,
                ...(r.thickness ? { thickness: r.thickness.byVertex, minWall: r.thickness.min, thinFraction: r.thickness.thinFraction } : {}),
              };
              transfer.push(d.severity.buffer as ArrayBuffer);
              if (d.thickness) transfer.push(d.thickness.buffer as ArrayBuffer);
              out.push(d);
            }
            post({ type: "check", id: msg.id, printability: out }, transfer);
          } else {
            post({ type: "check", id: msg.id, interference: await interference(k, msg.parts) });
          }
        } catch (err) {
          post({ type: "check", id: msg.id, error: String((err as Error)?.message ?? err) });
        }
        break;
      }
      case "export": {
        await requireKernel();
        try {
          const data =
            msg.format === "dxf" || msg.format === "svg"
              ? await export2D(pool!, msg.parts, msg.format)
              : msg.format === "step"
                ? await pool!.step(msg.parts.map((p) => p.name), lastDoc)
                : await exportMesh(msg.parts, msg.format, msg.tolerance ?? 0.01);
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

/** Interference in the local kernel (all parts together), with a mesh of each overlap; then restore. */
async function interference(k: KernelHost, names: string[]): Promise<InterferenceData> {
  if (!lastDoc) return { pairs: [], checked: 0, errors: [], millis: 0 };
  const doc = { parts: (lastDoc.parts ?? []).filter((p) => names.includes(p.name ?? "")) };
  const r = await checkInterference(k, doc, { restore: false });
  const pairs: InterferenceData["pairs"] = r.pairs.map((p) => ({ a: p.a, b: p.b, volume: p.volume }));
  if (pairs.length) {
    const byName = new Map(doc.parts.map((p) => [p.name, p.node]));
    const shared = { parts: pairs.map((p, i) => ({ name: `__overlap_${i}`, node: { type: "intersection" as const, children: [byName.get(p.a)!, byName.get(p.b)!] } })) };
    await k.evaluate(shared);
    for (let i = 0; i < pairs.length; i++) {
      const m = await k.mesh(`__overlap_${i}`);
      if (m) pairs[i]!.mesh = { positions: m.positions, indices: m.indices };
    }
  }
  await pool!.restoreLocal(lastDoc);
  return { pairs, checked: r.checked, errors: r.errors, millis: r.millis };
}

async function exportMesh(parts: { name: string; color?: string }[], format: "stl" | "3mf" | "glb" | "obj", tolerance: number): Promise<Uint8Array | string> {
  const meshed: ExportPart[] = [];
  for (const p of parts) meshed.push({ name: p.name, color: p.color, mesh: await pool!.meshAt(p.name, tolerance) });
  return format === "stl" ? toSTL(meshed, { binary: true }) : format === "3mf" ? to3MF(meshed) : format === "glb" ? toGLB(meshed) : toOBJ(meshed);
}

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
  await requireKernel();
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
  let meshes: Map<string, import("../kernel").MeshArrays>;
  try {
    lastRaw = rendered;
    const ev = await pool!.evaluate(rendered.document);
    result = ev.result;
    meshes = ev.meshes;
    lastDoc = rendered.document;
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
      const m = meshes!.get(r.name);
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
    sketches: await sketchesOf(rendered, docParts, (result as any).frames),
    assembly: await assemblyOf(rendered),
    schema: lastSchema,
    values: rendered.values ?? values,
    warnings: (rendered.warnings as string[]) ?? [],
    cacheHits: result.cacheHits,
    cacheMisses: result.cacheMisses,
    timings: { render: t1 - t0, kernel: t2 - t1, mesh: t3 - t2, total: t3 - t0 },
    workers: Math.min(pool!.size, docParts.length || 1),
    seq: ++seq,
  };
  previous = current;
  current = {
    doc: rendered.document,
    stats: new Map(parts.map((p) => [p.name, { volume: p.volume, bbox: p.bbox }])),
    values: { ...(rendered.values ?? values) },
    seq: data.seq,
  };
  post({ type: "result", data }, transfer);
  if (diffOn) await runDiff();
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

/** Mate drives are found once per module (they're structural), keyed by module URL + schema. */
let driveCache: { key: string; drives: MateData["drive"][] } | undefined;

/** Which numeric param moves each mate's angle/offset, and how fast: perturb each, re-render. */
function findDrives(rendered: any): MateData["drive"][] {
  const mates = rendered.assembly?.mates ?? [];
  const key = `${modUrl}|${JSON.stringify(rendered.params)}`;
  if (driveCache?.key === key) return driveCache.drives;
  const drives: MateData["drive"][] = mates.map(() => undefined);
  const wanted = mates.some((m: any) => m.angle !== undefined || m.offset !== undefined);
  if (wanted) {
    for (const [k, spec] of Object.entries((rendered.params ?? {}) as ParamSchemaData)) {
      if (spec.type !== "number" && spec.type !== "int") continue;
      const v = Number(rendered.values?.[k]);
      if (!isFinite(v)) continue;
      let d = spec.type === "int" ? 1 : Math.max(spec.step ?? 0, 1e-3 * Math.abs((spec.max ?? v + 1) - (spec.min ?? v - 1)), 1e-3);
      if (spec.max !== undefined && v + d > spec.max) d = -d;
      let r2: any;
      try {
        r2 = renderModule(mod, { ...rendered.values, [k]: v + d });
      } catch {
        continue;
      }
      r2.assembly?.mates?.forEach((m2: any, i: number) => {
        const m = mates[i];
        if (!m) return;
        for (const field of ["angle", "offset"] as const) {
          if (m[field] === undefined || m2[field] === undefined) continue;
          const scale = (m2[field] - m[field]) / d;
          if (Math.abs(scale) < 1e-9) continue;
          const cur = (drives[i] ??= {});
          cur[field] ??= { param: k, scale };
        }
      });
    }
  }
  driveCache = { key, drives };
  return drives;
}

async function assemblyOf(rendered: any): Promise<AssemblyData | undefined> {
  const a = rendered.assembly;
  if (!a) return undefined;
  const drives = findDrives(rendered);
  const mates: MateData[] = [];
  for (let i = 0; i < a.mates.length; i++) {
    const m = a.mates[i];
    mates.push({ ...m, loc: (await locate(normalizeLoc(m.loc))).loc, ...(drives[i] ? { drive: drives[i] } : {}) });
  }
  const anchors = [];
  for (const x of a.anchors) anchors.push({ part: x.part, id: x.id, frame: x.frame, loc: (await locate(normalizeLoc(x.loc))).loc });
  return { parts: a.parts, mates, anchors };
}

/** Row-major 4×4 product. */
function mul4rm(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k]! * b[k * 4 + c]!;
  return o;
}

/** The render's constraint sketches with their source locations mapped to the TSX. */
async function sketchesOf(rendered: any, docParts: { name?: string }[], frames?: Map<string, number[]> | Record<string, number[]>): Promise<SketchData[]> {
  const frameOf = (path: string) => (frames instanceof Map ? frames.get(path) : frames?.[path]);
  const out: SketchData[] = [];
  for (const s of (rendered.sketches as any[] | undefined) ?? []) {
    const partIndex = Number(String(s.path).split("/")[1]);
    const dims = [];
    for (const d of s.dimensions ?? []) dims.push({ kind: d.kind, value: d.value, text: d.text, points: d.points, loc: (await locate(normalizeLoc(d.loc))).loc });
    out.push({
      path: s.path,
      // A sketch on a face: its plane is relative to the face frame the kernel used.
      plane: s.onFace && frameOf(s.onFace) ? mul4rm(frameOf(s.onFace)!, s.plane) : s.plane,
      loc: (await locate(normalizeLoc(s.loc))).loc,
      status: s.status,
      dof: s.dof,
      free: s.free ?? [],
      residual: s.residual ?? 0,
      points: s.points ?? [],
      entities: s.entities ?? [],
      dimensions: dims,
      patterns: await Promise.all(((s.patterns ?? []) as any[]).map(async (p) => ({ ...p, loc: (await locate(normalizeLoc(p.loc))).loc }))),
      part: docParts[partIndex]?.name,
    });
  }
  return out;
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
