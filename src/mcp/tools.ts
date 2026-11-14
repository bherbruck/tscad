/**
 * The tscad MCP tools: evaluate, render, export, pick selectors, examples, docs.
 * Models are bundled and run exactly like the CLI does (src/cli/model.ts).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PKG_ROOT } from "../cli/bundle";
import { describeError, runModel, type ModelRun } from "../cli/model";
import { parseView } from "../cli/render";
import { codeFrame } from "../cli/ui";
import type { Selector } from "../ir";
import { checkInterference, checkPrintability, checkWatertight } from "../check";
import { massOf } from "../core/materials";
import { section, toDXF, toSVG } from "../drawing";
import { exportModel, type ExportFormat } from "../export";
import type { MeshArrays } from "../kernel";
import { renderPNG, type RenderPart } from "../render";
import { elementsMarkdown, lookupReference, partsMarkdown, referenceNames } from "./reference";
import { GUIDE } from "./guide";
import { selectorCode, selectorString } from "./selectors";

// ---------------------------------------------------------------------------------------------
// Tool result shapes (MCP 2025-06-18)

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
/** An MCP `tools/call` result. */
export interface ToolResult {
  content: Content[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
/** An MCP tool: its listing plus the function that runs it. */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run(args: Record<string, any>): Promise<ToolResult>;
}

/** A user-facing problem with the arguments (reported as a tool error, not a protocol error). */
export class ToolInputError extends Error {}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ---------------------------------------------------------------------------------------------
// Model input

const MODEL_PROPS = {
  source: { type: "string", description: "The model's TSX source (a module with `export default function Model() { return <part>...</part> }`). Give this or `file`." },
  file: { type: "string", description: "Path to a .tsx model file (relative to `baseDir` or the server's cwd). Give this or `source`." },
  params: { type: "object", description: "Parameter overrides, e.g. {\"width\": 80, \"style\": \"round\"} (coerced and clamped to the model's params).", additionalProperties: true },
  baseDir: { type: "string", description: "Directory for relative paths; with `source`, the model is written there (hidden temp file) so its relative imports work. Default: the server's cwd for files, a temp dir for source." },
} as const;

let counter = 0;
const TMP = join(tmpdir(), `tscad-mcp-${process.pid}`);

interface ModelCtx {
  file: string;
  /** Name to show for the file in messages. */
  display: string;
  rewrite(text: string): string;
}

async function withModel<T>(args: Record<string, any>, fn: (m: ModelCtx) => Promise<T>): Promise<T> {
  const base = args.baseDir ? resolve(String(args.baseDir)) : process.cwd();
  if (typeof args.source === "string" && args.source.trim()) {
    const dir = args.baseDir ? base : TMP;
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `.tscad-mcp-${process.pid}-${counter++}.tsx`);
    writeFileSync(file, args.source);
    const ctx: ModelCtx = { file, display: "model.tsx", rewrite: (t) => t.split(file).join("model.tsx") };
    try {
      return await fn(ctx);
    } finally {
      rmSync(file, { force: true });
    }
  }
  if (typeof args.file === "string" && args.file) {
    const file = resolve(base, args.file);
    if (!existsSync(file)) throw new ToolInputError(`no such file: ${file}`);
    return fn({ file, display: file, rewrite: (t) => t });
  }
  throw new ToolInputError("give the model as `source` (TSX text) or `file` (a path)");
}

function params(args: Record<string, any>): Record<string, unknown> {
  const p = args.params;
  if (p === undefined || p === null) return {};
  if (typeof p !== "object" || Array.isArray(p)) throw new ToolInputError("`params` must be an object of name → value");
  return p;
}

// one kernel session: run tool calls one at a time
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(f: () => Promise<T>): Promise<T> {
  const r = queue.then(f, f);
  queue = r.catch(() => undefined);
  return r;
}

/** Run a model; console output from the model is captured (never written to the MCP stdout). */
async function run(m: ModelCtx, args: Record<string, any>, opts: { noMesh?: boolean; parallel?: boolean } = {}): Promise<{ run?: ModelRun; error?: string; logs: string[] }> {
  const logs: string[] = [];
  const saved = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
  const cap = (...a: unknown[]) => logs.push(a.map((x) => (typeof x === "string" ? x : Bun.inspect(x))).join(" "));
  console.log = console.info = console.debug = console.warn = cap;
  try {
    const r = await runModel(m.file, params(args), opts);
    return { run: r, logs };
  } catch (e) {
    return { error: m.rewrite(explain(stripAnsi(describeError(e, m.file)), m.file)), logs };
  } finally {
    Object.assign(console, saved);
  }
}

/** Add what an agent needs to fix common errors: a missing import, a location for errors without one. */
function explain(text: string, file: string): string {
  let out = text;
  // `X is not defined` for a tscad / tscad/parts export: say what to import
  const undef = text.match(/ReferenceError: (\w+) is not defined/);
  if (undef) {
    const name = undef[1]!;
    const from = (PARTS_EXPORTS as readonly string[]).includes(name) ? "tscad/parts" : (TSCAD_EXPORTS as readonly string[]).includes(name) ? "tscad" : undefined;
    if (from) out += `\n  hint: import { ${name} } from "${from}"`;
  }
  // no `at file:line`: find the element by its tag in the source
  const tag = text.match(/\(in <(\w+)[ >]/);
  if (tag && !/\n\s+at /.test(text)) {
    try {
      const lines = readFileSync(file, "utf8").split("\n");
      const hits: [number, number][] = [];
      lines.forEach((l, i) => {
        for (const mm of l.matchAll(new RegExp(`<${tag[1]}\\b`, "g"))) hits.push([i + 1, mm.index! + 1]);
      });
      if (hits.length) {
        const [line, col] = hits[0]!;
        out += `\n  at model.tsx:${line}:${col}${hits.length > 1 ? ` (first of ${hits.length} <${tag[1]}> elements)` : ""}\n${stripAnsi(codeFrame(lines.join("\n"), line, col)).split("\n").map((x) => `  ${x}`).join("\n")}`;
      }
    } catch {
      /* no source */
    }
  }
  return out;
}

const PARTS_EXPORTS = ["Hole", "CounterboreHole", "CountersinkHole", "TapHole", "NutTrap", "HeatSetInsert", "Standoff", "BoltPattern", "MountHoles", "Extrusion2020", "HexPrism", "FingerJointBox", "LivingHinge", "metric", "mountPatterns", "metricData"] as const;
const TSCAD_EXPORTS = ["defineParams", "edges", "faces", "helix", "polyline3", "arc3", "bezier3", "inch", "range", "linspace", "materials", "createContext", "useContext", "sketchRefs", "sketchRef", "sketchPath", "assemblyRefs", "anchorRef"] as const;

// ---------------------------------------------------------------------------------------------
// Evaluate

type Loc = { file: string; line: number; column: number; tag?: string; component?: string };

function locFor(path: string, sourceMap: Record<string, Loc>): Loc | undefined {
  let p = path;
  for (;;) {
    if (sourceMap[p]) return sourceMap[p];
    const i = p.lastIndexOf("/");
    if (i < 0) return undefined;
    p = p.slice(0, i);
  }
}

function frame(loc: Loc): string {
  try {
    return stripAnsi(codeFrame(readFileSync(loc.file, "utf8"), loc.line, loc.column || 1));
  } catch {
    return "";
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function summarize(m: ModelCtx, r: ModelRun, logs: string[]) {
  const { rendered, result, timings } = r;
  const sm = rendered.sourceMap as Record<string, Loc>;
  const parts = result.parts.map((p) => {
    const info = rendered.parts.find((i) => i.name === p.name);
    const out: Record<string, unknown> = { name: p.name, ok: p.ok };
    if (p.empty) out.empty = true;
    if (p.volume !== undefined) out.volume_mm3 = r3(p.volume);
    if (p.area !== undefined) out.area_mm2 = r3(p.area);
    if (p.volume !== undefined && info?.density) {
      out.mass_g = r3(massOf(p.volume, info.density));
      out.density = info.density;
    }
    if (info?.material) out.material = info.material;
    if (info?.color) out.color = info.color;
    if (p.bbox) {
      out.bbox = p.bbox.map((v) => v.map(r3));
      out.size = [0, 1, 2].map((i) => r3(p.bbox![1][i]! - p.bbox![0][i]!));
    }
    if (p.counts) out.faces_edges_vertices = p.counts;
    out.millis = Math.round(p.millis);
    if (p.cached) out.cached = true;
    if (p.warnings?.length) out.warnings = p.warnings;
    if (p.error) {
      const loc = locFor(p.error.path, sm);
      out.error = {
        op: p.error.op,
        message: p.error.message,
        path: p.error.path,
        ...(loc ? { at: `${m.display}:${loc.line}:${loc.column}`, element: loc.tag, ...(loc.component && !/^__|_default$/.test(loc.component) ? { component: loc.component } : {}), frame: frame(loc) } : {}),
      };
    }
    return out;
  });
  const structured = {
    ok: result.ok,
    parts,
    drawings: rendered.drawings.map((d) => ({ name: d.name, loops: d.loops.length, ...(d.thickness ? { thickness: d.thickness } : {}) })),
    warnings: rendered.warnings.map((w) => m.rewrite(w)),
    params: Object.fromEntries(Object.entries(rendered.params).map(([k, s]) => [k, { ...s, value: (rendered.values as any)[k] }])),
    timings_ms: { import: Math.round(timings.import), render: Math.round(timings.render), kernel: Math.round(timings.kernel) },
    ...(logs.length ? { logs } : {}),
  };
  const lines: string[] = [];
  lines.push(`${result.ok ? "OK" : "FAILED"}: ${parts.length} part(s), ${structured.drawings.length} drawing(s) — import ${structured.timings_ms.import} ms, kernel ${structured.timings_ms.kernel} ms`);
  for (const p of parts as any[]) {
    if (p.ok) {
      lines.push(
        `- ${p.name}: volume ${p.volume_mm3} mm³${p.mass_g !== undefined ? `, mass ${p.mass_g} g (${p.material ?? `${p.density} g/cm³`})` : ""}, size ${p.size?.join(" × ") ?? "—"} mm, bbox ${JSON.stringify(p.bbox)}, ${p.faces_edges_vertices ? `${p.faces_edges_vertices[0]} faces / ${p.faces_edges_vertices[1]} edges` : ""}${p.empty ? " (EMPTY)" : ""}`,
      );
    } else {
      const e = p.error;
      lines.push(`- ${p.name}: ERROR in ${e.op}: ${e.message}${e.at ? ` at ${e.at}${e.element ? ` <${e.element}>` : ""}${e.component ? ` (in <${e.component}>)` : ""}` : ` (node ${e.path})`}`);
      if (e.frame) lines.push(e.frame.split("\n").map((l: string) => `    ${l}`).join("\n"));
    }
  }
  for (const d of structured.drawings) lines.push(`- drawing ${d.name}: ${d.loops} loop(s)`);
  if (structured.warnings.length) lines.push(`warnings:\n${structured.warnings.map((w) => `  - ${w}`).join("\n")}`);
  const ps = Object.entries(structured.params);
  if (ps.length) lines.push(`params: ${ps.map(([k, s]: [string, any]) => `${k}=${JSON.stringify(s.value)}`).join(", ")}`);
  if (logs.length) lines.push(`console:\n${logs.map((l) => `  ${l}`).join("\n")}`);
  return { structured, text: lines.join("\n") };
}

async function evaluateTool(args: Record<string, any>): Promise<ToolResult> {
  return withModel(args, async (m) => {
    const r = await run(m, args, { noMesh: true });
    if (!r.run) return { content: [{ type: "text", text: r.error! }], structuredContent: { ok: false, error: r.error }, isError: true };
    const { structured, text } = summarize(m, r.run, r.logs);
    return { content: [{ type: "text", text }], structuredContent: structured, isError: !r.run.result.ok };
  });
}

// ---------------------------------------------------------------------------------------------
// Render

async function renderTool(args: Record<string, any>): Promise<ToolResult> {
  let view;
  try {
    view = parseView(args.view);
  } catch (e) {
    throw new ToolInputError((e as Error).message);
  }
  const width = clampInt(args.width, 800, 64, 2048), height = clampInt(args.height, 600, 64, 2048);
  return withModel(args, async (m) => {
    const r = await run(m, args);
    if (!r.run) return { content: [{ type: "text", text: r.error! }], isError: true };
    const { structured, text } = summarize(m, r.run, r.logs);
    const colors = new Map((r.run.rendered.document.parts ?? []).map((p) => [p.name ?? "", p.color]));
    const only: string[] | undefined = Array.isArray(args.parts) ? args.parts.map(String) : undefined;
    const parts: RenderPart[] = [];
    for (const p of r.run.result.parts) {
      if (!p.ok || p.empty || (only && !only.includes(p.name))) continue;
      const mesh = await r.run.kernel.mesh(p.name);
      if (mesh) parts.push({ name: p.name, color: colors.get(p.name), mesh } as RenderPart);
    }
    if (!parts.length) return { content: [{ type: "text", text: `nothing to render\n${text}` }], structuredContent: structured, isError: true };
    const png = renderPNG(parts, {
      width,
      height,
      view,
      background: args.background ?? "light",
      edges: args.edges !== false,
      ...(args.ortho ? { projection: "orthographic" as const } : {}),
    });
    return {
      content: [
        { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
        { type: "text", text },
      ],
      structuredContent: structured,
      isError: !r.run.result.ok,
    };
  });
}

function clampInt(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : dflt;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
}

// ---------------------------------------------------------------------------------------------
// Export

const FORMATS = ["step", "stl", "3mf", "glb", "obj", "dxf", "svg"] as const;

async function exportTool(args: Record<string, any>): Promise<ToolResult> {
  const fmt = String(args.format ?? (args.path ? String(args.path).split(".").pop() : "")).toLowerCase().replace(/^stp$/, "step");
  if (!(FORMATS as readonly string[]).includes(fmt)) throw new ToolInputError(`format must be one of ${FORMATS.join(", ")}`);
  return withModel(args, async (m) => {
    // STEP needs every part in one kernel session: skip the parallel kernel processes
    const r = await run(m, args, { noMesh: fmt === "step", ...(fmt === "step" ? { parallel: false } : {}) });
    if (!r.run) return { content: [{ type: "text", text: r.error! }], isError: true };
    const { rendered, result, kernel } = r.run;
    const failed = result.parts.filter((p) => !p.ok);
    if (failed.length) {
      const { text } = summarize(m, r.run, r.logs);
      return { content: [{ type: "text", text: `not exported: the model has errors\n${text}` }], isError: true };
    }
    const only: string[] | undefined = Array.isArray(args.parts) ? args.parts.map(String) : undefined;
    const docParts = (rendered.document.parts ?? []).filter((p) => !only || only.includes(p.name ?? "")).map((p) => ({ name: p.name ?? "", ...(p.color ? { color: p.color } : {}) }));
    const stem = basename(m.display).replace(/\.[jt]sx?$/, "") || "model";
    const base = args.baseDir ? resolve(String(args.baseDir)) : process.cwd();
    const out = resolve(base, args.path ? String(args.path) : `${stem}.${fmt}`);
    let data: string | Uint8Array;
    let note = "";
    if (fmt === "dxf" || fmt === "svg") {
      const drawings = rendered.drawings.filter((d) => !only || only.includes(d.name));
      let input: any = drawings;
      if (!drawings.length) {
        // no <drawing>: slice the solids
        const loops = [];
        for (const p of docParts) {
          const pr = result.parts.find((x) => x.name === p.name);
          const z = typeof args.sectionZ === "number" ? args.sectionZ : pr?.bbox ? (pr.bbox[0][2] + pr.bbox[1][2]) / 2 : 0;
          const mesh: MeshArrays = await kernel.meshAt(p.name, typeof args.tolerance === "number" ? args.tolerance : 0.01);
          const s = section(mesh, { origin: [0, 0, z], normal: [0, 0, 1] });
          loops.push({ name: p.name, loops: s.loops.map((poly) => poly.map((q, i) => ({ kind: "line" as const, a: q, b: poly[(i + 1) % poly.length]! }))) });
          note += `section of ${p.name} at z = ${r3(z)}: ${s.loops.length} loop(s)\n`;
        }
        input = loops;
      }
      data = fmt === "dxf" ? toDXF(input, { entities: args.dxfEntities === "polyline" ? "polyline" : "primitives" }) : toSVG(input);
    } else {
      if (!docParts.length) throw new ToolInputError("no parts to export");
      data = await exportModel(kernel, docParts, fmt as ExportFormat, typeof args.tolerance === "number" ? { tolerance: args.tolerance } : {});
    }
    const flat = fmt === "dxf" || fmt === "svg";
    const usedDrawings = flat ? rendered.drawings.filter((d) => !only || only.includes(d.name)).map((d) => d.name) : [];
    const what = flat && usedDrawings.length ? `drawings: ${usedDrawings.join(", ")}` : `parts: ${docParts.map((p) => p.name).join(", ") || "—"}`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
    const bytes = statSync(out).size;
    return {
      content: [{ type: "text", text: `${note}wrote ${out} (${fmt.toUpperCase()}, ${bytes} bytes, ${what})` }],
      structuredContent: { path: out, format: fmt, bytes, parts: docParts.map((p) => p.name) },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Pick selectors

type V3 = [number, number, number];

function nearestEdge(mesh: MeshArrays, p: V3): { id: number; dist: number } | undefined {
  let best: { id: number; dist: number } | undefined;
  let off = 0;
  for (let k = 0; k < mesh.edgeCounts.length; k++) {
    const n = mesh.edgeCounts[k]!;
    for (let i = 0; i + 1 < n; i++) {
      const a = off + i, b = off + i + 1;
      const d = segDist(p, [mesh.edgePoints[3 * a]!, mesh.edgePoints[3 * a + 1]!, mesh.edgePoints[3 * a + 2]!], [mesh.edgePoints[3 * b]!, mesh.edgePoints[3 * b + 1]!, mesh.edgePoints[3 * b + 2]!]);
      if (!best || d < best.dist) best = { id: mesh.edgeIds[k]!, dist: d };
    }
    off += n;
  }
  return best;
}
function segDist(p: V3, a: V3, b: V3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
  const t = l2 ? Math.max(0, Math.min(1, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / l2)) : 0;
  return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t);
}
function nearestFace(mesh: MeshArrays, p: V3): { id: number; dist: number } | undefined {
  let best: { id: number; dist: number } | undefined;
  const P = mesh.positions;
  const v = (i: number): V3 => [P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const d = triDist(p, v(mesh.indices[3 * t]!), v(mesh.indices[3 * t + 1]!), v(mesh.indices[3 * t + 2]!));
    if (!best || d < best.dist) best = { id: mesh.faceIds[t]!, dist: d };
  }
  return best;
}
/** Distance from p to triangle abc (closest point, Ericson). */
function triDist(p: V3, a: V3, b: V3, c: V3): number {
  const sub = (x: V3, y: V3): V3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x: V3, y: V3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const at = (q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return segDist(p, a, b);
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return segDist(p, a, c);
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return segDist(p, b, c);
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

async function pickTool(args: Record<string, any>): Promise<ToolResult> {
  const kind = args.kind === "face" ? "face" : "edge";
  const point = Array.isArray(args.point) && args.point.length === 3 ? (args.point.map(Number) as V3) : undefined;
  if (args.index === undefined && !point) throw new ToolInputError("give `point` [x, y, z] near the edge/face, or its `index`");
  return withModel(args, async (m) => {
    const r = await run(m, args);
    if (!r.run) return { content: [{ type: "text", text: r.error! }], isError: true };
    const parts = r.run.result.parts.filter((p) => p.ok && !p.empty);
    const name = args.part ? String(args.part) : parts[0]?.name;
    if (!name || !parts.some((p) => p.name === name)) throw new ToolInputError(`no evaluated part ${JSON.stringify(args.part)} (parts: ${parts.map((p) => p.name).join(", ")})`);
    let index = typeof args.index === "number" ? args.index : -1;
    let dist: number | undefined;
    if (point) {
      const mesh = await r.run.kernel.mesh(name);
      if (!mesh) throw new ToolInputError(`part ${name} has no mesh`);
      const hit = kind === "edge" ? nearestEdge(mesh, point) : nearestFace(mesh, point);
      if (!hit) throw new ToolInputError(`part ${name} has no ${kind}s`);
      index = hit.id;
      dist = hit.dist;
    }
    const info = kind === "edge" ? await r.run.kernel.pickEdge(name, index) : await r.run.kernel.pickFace(name, index);
    const root = kind === "edge" ? "edges" : "faces";
    const suggestions: { count: number | null; string?: string | undefined; code: string; selector: Selector }[] = info.suggestions.map((s) => ({ count: s.count, string: selectorString(s.selector), code: selectorCode(s.selector, root), selector: s.selector }));
    // when no geometric selector picks it alone, offer a box around it (robust to edits elsewhere)
    if (!suggestions.some((s) => s.count === 1 && s.selector.type !== "index") && info.points.length) {
      const pad = 0.01;
      const lo = [0, 1, 2].map((k) => Math.min(...info.points.map((p) => p[k]!)) - pad) as [number, number, number];
      const hi = [0, 1, 2].map((k) => Math.max(...info.points.map((p) => p[k]!)) + pad) as [number, number, number];
      const within: Selector = { type: "within", min: lo.map(r3) as [number, number, number], max: hi.map(r3) as [number, number, number] };
      const idx = suggestions.findIndex((s) => s.selector.type === "index");
      suggestions.splice(idx < 0 ? suggestions.length : idx, 0, { count: null, code: selectorCode(within, root), selector: within });
    }
    const structured = {
      part: name,
      kind,
      index,
      ...(dist !== undefined ? { distance: r3(dist) } : {}),
      geometry: info.kind,
      ...(info.radius !== undefined ? { radius: r3(info.radius) } : {}),
      ...(info.direction ? { direction: info.direction.map(r3) } : {}),
      suggestions,
    };
    const text = [
      `${kind} ${index} of ${name}: ${info.kind}${info.radius !== undefined ? ` r=${r3(info.radius)}` : ""}${info.direction ? ` dir=[${info.direction.map(r3).join(", ")}]` : ""}${dist !== undefined ? ` (${r3(dist)} mm from the point)` : ""}`,
      "selectors (most specific first; count = how many it selects):",
      ...suggestions.map((s) => `- ${s.string ? `"${s.string}"  ` : ""}${s.code}  → ${s.count ?? "probably 1 (a box around it; anything else wholly inside also matches)"}`),
    ].join("\n");
    return { content: [{ type: "text", text }], structuredContent: structured };
  });
}

// ---------------------------------------------------------------------------------------------
// Check

type B3 = [[number, number, number], [number, number, number]];

/** Bounds of the given triangles (or of every triangle of B-rep face `faceId`). */
function trianglesBox(mesh: MeshArrays, tris: Iterable<number>): B3 {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[3 * t + k]! * 3;
      for (let c = 0; c < 3; c++) {
        const x = mesh.positions[v + c]!;
        if (x < lo[c]!) lo[c] = x;
        if (x > hi[c]!) hi[c] = x;
      }
    }
  return [lo, hi];
}

const orientName = (d: [number, number, number]) =>
  d[2] === -1 ? "upside down" : d[0] !== 0 ? `on its ${d[0] > 0 ? "−X" : "+X"} side` : `on its ${d[1] > 0 ? "−Y" : "+Y"} side`;
const pct = (f: number) => (f > 0 && f < 0.001 ? "< 0.1 %" : `${r1(f * 100)} %`);
const r1 = (v: number) => Math.round(v * 10) / 10;
const fmtBox = (b: B3) => `x ${r1(b[0][0])}..${r1(b[1][0])}, y ${r1(b[0][1])}..${r1(b[1][1])}, z ${r1(b[0][2])}..${r1(b[1][2])}`;
const fmtPt = (p: number[]) => `(${p.map(r1).join(", ")})`;

async function checkTool(args: Record<string, any>): Promise<ToolResult> {
  const opts = {
    ...(Array.isArray(args.buildDir) ? { buildDir: args.buildDir.map(Number) as [number, number, number] } : {}),
    ...(typeof args.maxOverhangDeg === "number" ? { maxOverhangDeg: args.maxOverhangDeg } : {}),
    ...(typeof args.minWall === "number" ? { minWall: args.minWall } : {}),
    ...(Array.isArray(args.bed) && args.bed.length === 3 ? { bed: args.bed.map(Number) as [number, number, number] } : {}),
  };
  const maxDeg = opts.maxOverhangDeg ?? 45, minWall = opts.minWall ?? 0.8;
  return withModel(args, async (m) => {
    const r = await run(m, args);
    if (!r.run) return { content: [{ type: "text", text: r.error! }], isError: true };
    const { kernel, result, rendered } = r.run;
    const failed = result.parts.filter((p) => !p.ok);
    if (failed.length) {
      const { text } = summarize(m, r.run, r.logs);
      return { content: [{ type: "text", text: `can't check: the model has errors\n${text}` }], isError: true };
    }
    const only: string[] | undefined = Array.isArray(args.parts) ? args.parts.map(String) : undefined;
    const lines: string[] = [];
    const parts: Record<string, unknown>[] = [];
    let problems = 0;
    for (const p of result.parts) {
      if (p.empty || (only && !only.includes(p.name))) continue;
      const mesh = await kernel.mesh(p.name);
      if (!mesh) continue;
      const pr = checkPrintability(mesh, opts);
      // would another orientation print with fewer overhangs?
      let better: { dir: [number, number, number]; area: number } | undefined;
      if (pr.overhang.area > 1 && !opts.buildDir) {
        for (const dir of [[0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as [number, number, number][]) {
          const a = checkPrintability(mesh, { ...opts, buildDir: dir, skipThickness: true }).overhang.area;
          if (a < (better?.area ?? pr.overhang.area * 0.5)) better = { dir, area: a };
        }
      }
      const wt = checkWatertight(mesh);
      // overhang faces with where they are and a selector naming them
      const faceTris = new Map<number, number[]>();
      for (const t of pr.overhang.triangles) {
        const f = mesh.faceIds[t]!;
        (faceTris.get(f) ?? faceTris.set(f, []).get(f)!).push(t);
      }
      const faces = [];
      for (const f of pr.overhang.faces.slice(0, 8)) {
        const box = trianglesBox(mesh, faceTris.get(f.faceId) ?? []);
        let selector: string | undefined;
        try {
          const info = await kernel.pickFace(p.name, f.faceId);
          // the most specific suggestion that isn't a fragile index
          const s = info.suggestions.find((x) => x.selector.type !== "index");
          if (s) selector = `${selectorString(s.selector) ?? selectorCode(s.selector, "faces")}${s.count > 1 ? ` (selects ${s.count} faces)` : ""}`;
        } catch {
          /* no pick info */
        }
        faces.push({ faceId: f.faceId, area: r3(f.area), angle: r1(f.maxAngle), bbox: box.map((v) => v.map(r3)), ...(selector ? { selector } : {}) });
      }
      // thinnest wall: where
      let thin: Record<string, unknown> | undefined;
      if (pr.thickness && Number.isFinite(pr.thickness.min)) {
        let worst = -1;
        for (let t = 0; t < pr.thickness.byTriangle.length; t++) if (worst < 0 || pr.thickness.byTriangle[t]! < pr.thickness.byTriangle[worst]!) worst = t;
        const box = trianglesBox(mesh, [worst]);
        const at = [0, 1, 2].map((c) => (box[0][c]! + box[1][c]!) / 2);
        thin = { min: r3(pr.thickness.min), at: at.map(r3), faceId: mesh.faceIds[worst], thinArea: r3(pr.thickness.thinArea), thinFraction: r3(pr.thickness.thinFraction) };
      }
      const ok = pr.overhang.area === 0 && (!pr.thickness || pr.thickness.thinArea === 0) && (!pr.bed || pr.bed.fits) && wt.watertight;
      if (!ok) problems++;
      parts.push({
        name: p.name,
        ok,
        size: pr.size.map(r3),
        overhang: { area: r3(pr.overhang.area), fraction: r3(pr.overhang.fraction), faces },
        ...(thin ? { thickness: thin } : {}),
        ...(pr.bed ? { bed: pr.bed } : {}),
        ...(better ? { betterOrientation: { buildDir: better.dir, overhangArea: r3(better.area) } } : {}),
        watertight: wt.watertight,
        ...(wt.watertight ? {} : { mesh: { boundaryEdges: wt.boundaryEdges, nonManifoldEdges: wt.nonManifoldEdges, flippedEdges: wt.flippedEdges } }),
      });
      lines.push(`${p.name}: ${ok ? "OK" : "ISSUES"} — size ${pr.size.map(r1).join(" × ")} mm`);
      if (faces.length) {
        lines.push(`  - overhangs > ${maxDeg}°: ${pr.overhang.faces.length} face(s), ${r1(pr.overhang.area)} mm² (${r1(pr.overhang.fraction * 100)} % of the surface)`);
        for (const f of faces) lines.push(`      face ${f.faceId}: ${f.area} mm² at ${f.angle}° from vertical, ${fmtBox(f.bbox as B3)}${f.selector ? `, selector ${f.selector}` : ""}`);
      } else lines.push(`  - overhangs > ${maxDeg}°: none`);
      if (thin) lines.push(`  - thinnest wall ${thin.min} mm near ${fmtPt(thin.at as number[])}${(thin.thinArea as number) > 0 ? `; ${pct(thin.thinFraction as number)} of the surface is thinner than ${minWall} mm` : ` (≥ ${minWall} mm everywhere)`}`);
      if (pr.bed) lines.push(`  - bed ${opts.bed!.join(" × ")}: ${pr.bed.fits ? (pr.bed.rotated ? "fits turned 90°" : "fits") : "DOES NOT FIT"}`);
      if (better) lines.push(`  - print it with buildDir [${better.dir.join(", ")}] (${orientName(better.dir)}): overhangs drop to ${r1(better.area)} mm²`);
      lines.push(`  - mesh: ${wt.watertight ? "watertight" : `NOT watertight (${wt.boundaryEdges} open, ${wt.nonManifoldEdges} non-manifold, ${wt.flippedEdges} flipped edges)`}`);
    }
    let interference: Record<string, unknown> | undefined;
    const docParts = (rendered.document.parts ?? []).filter((p) => !only || only.includes(p.name ?? ""));
    if (args.interference !== false && docParts.length > 1) {
      const ir = await checkInterference(kernel, { parts: docParts }, { restore: false, ...(typeof args.minVolume === "number" ? { minVolume: args.minVolume } : {}) });
      interference = { ok: ir.ok, pairs: ir.pairs.map((x) => ({ ...x, volume: r3(x.volume), bbox: x.bbox?.map((v) => v.map(r3)) })), checked: ir.checked, skipped: ir.skipped, errors: ir.errors };
      if (!ir.ok) problems++;
      lines.push(ir.ok ? `interference: none (${ir.checked} pair(s) checked, ${ir.skipped} apart)` : `interference:`);
      for (const x of ir.pairs) lines.push(`  - ${x.a} ∩ ${x.b}: ${r3(x.volume)} mm³${x.bbox ? ` in ${fmtBox(x.bbox)}` : ""}`);
      for (const e of ir.errors) lines.push(`  - ${e.a} ∩ ${e.b}: kernel error ${e.message}`);
    }
    lines.unshift(problems ? `${problems} issue(s) found` : "all checks passed");
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { ok: problems === 0, parts, ...(interference ? { interference } : {}), options: { maxOverhangDeg: maxDeg, minWall, ...opts } },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Examples & docs

const EXAMPLES = join(PKG_ROOT, "examples");

function exampleList(): { name: string; summary: string }[] {
  if (!existsSync(EXAMPLES)) return [];
  return readdirSync(EXAMPLES)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .sort()
    .map((f) => {
      const src = readFileSync(join(EXAMPLES, f), "utf8");
      const doc = src.match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? "";
      const summary = doc.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim()).filter((l) => l && !l.startsWith("tscad ")).join(" ");
      return { name: f.replace(/\.tsx$/, ""), summary };
    });
}

async function listExamplesTool(): Promise<ToolResult> {
  const list = exampleList();
  return {
    content: [{ type: "text", text: list.map((e) => `- ${e.name}: ${e.summary}`).join("\n") || "no examples installed" }],
    structuredContent: { examples: list },
  };
}

async function readExampleTool(args: Record<string, any>): Promise<ToolResult> {
  const name = String(args.name ?? "").replace(/\.tsx$/, "");
  const f = join(EXAMPLES, `${name}.tsx`);
  if (!/^[\w-]+$/.test(name) || !existsSync(f)) throw new ToolInputError(`no example ${JSON.stringify(args.name)} (examples: ${exampleList().map((e) => e.name).join(", ")})`);
  const source = readFileSync(f, "utf8");
  return { content: [{ type: "text", text: source }], structuredContent: { name, path: f, source } };
}

async function docsTool(args: Record<string, any>): Promise<ToolResult> {
  if (args.element) {
    const list = Array.isArray(args.element) ? args.element : [args.element];
    const found = list.map((e: unknown) => lookupReference(String(e)) ?? `### ${String(e)}\n(unknown — elements: ${referenceNames().elements.join(", ")}; parts: ${referenceNames().components.join(", ")})`);
    return { content: [{ type: "text", text: found.join("\n\n") }] };
  }
  const topic = String(args.topic ?? "guide");
  const n = referenceNames();
  const constraint = new Set(["point", "line", "arc", "spline", "dimension", "distance", "angle", "coincident", "equal", "parallel", "perpendicular", "tangent", "collinear", "concentric", "horizontal", "vertical", "symmetric", "midpoint", "onCurve", "fix", "mirrorEntities", "circularPattern"]);
  const index = `\n## Element index\nModelling: ${n.elements.filter((e) => !constraint.has(e)).map((e) => `<${e}>`).join(" ")}\nConstraint sketch (inside <sketch>): ${n.elements.filter((e) => constraint.has(e)).map((e) => `<${e}>`).join(" ")}\nParts library (import from "tscad/parts"): ${n.components.map((e) => `<${e}>`).join(" ")}\nCall tscad_docs with {"element": "<name>"} (or a list) for exact props, or {"topic": "elements"} for all.`;
  const text =
    topic === "elements" ? elementsMarkdown() : topic === "parts" ? partsMarkdown() : topic === "all" ? `${GUIDE}\n${elementsMarkdown()}\n\n${partsMarkdown()}` : GUIDE + index;
  return { content: [{ type: "text", text }] };
}

// ---------------------------------------------------------------------------------------------

const RO = { readOnlyHint: true, openWorldHint: false };

/** Every tool the tscad MCP server offers. */
export const TOOLS: ToolDef[] = [
  {
    name: "tscad_docs",
    title: "tscad reference",
    description:
      "How to write tscad models (CAD as TSX): the authoring guide (default), the full element/props reference (topic \"elements\"), the parts library (topic \"parts\"), or exact props of specific elements (`element`). Read this before writing a model.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", enum: ["guide", "elements", "parts", "all"], description: "Default \"guide\"." },
        element: { description: "Element or parts component name(s), e.g. \"extrude\" or [\"fillet\", \"CounterboreHole\"].", anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
      },
    },
    annotations: RO,
    run: docsTool,
  },
  {
    name: "tscad_evaluate",
    title: "Evaluate a tscad model",
    description:
      "Compile and evaluate a TSX model with the B-rep kernel. Returns per part: ok, volume (mm³), mass (g, when a material/density is set), bounding box and size (mm), face/edge counts, timings; plus warnings and params. Errors point at the TSX line with a code frame.",
    inputSchema: { type: "object", properties: { ...MODEL_PROPS } },
    annotations: RO,
    run: (a) => serial(() => evaluateTool(a)),
  },
  {
    name: "tscad_render",
    title: "Render a tscad model",
    description: "Evaluate a model and return a PNG image of it (shaded, with edges) plus the same summary as tscad_evaluate. Use it to check what you built.",
    inputSchema: {
      type: "object",
      properties: {
        ...MODEL_PROPS,
        view: { type: "string", description: "iso (default) | front | back | top | bottom | right | left | \"<azimuth>,<elevation>\" in degrees" },
        width: { type: "number", description: "Pixels, default 800 (64–2048)." },
        height: { type: "number", description: "Pixels, default 600 (64–2048)." },
        background: { type: "string", description: "light (default) | dark | transparent | a CSS colour" },
        ortho: { type: "boolean", description: "Orthographic projection." },
        edges: { type: "boolean", description: "Draw edge lines (default true)." },
        parts: { type: "array", items: { type: "string" }, description: "Only these parts." },
      },
    },
    annotations: RO,
    run: (a) => serial(() => renderTool(a)),
  },
  {
    name: "tscad_export",
    title: "Export a tscad model",
    description:
      "Evaluate a model and write it to a file: step (exact B-rep), stl, 3mf, glb, obj (meshes), or dxf/svg (2D: the model's <drawing>s, or else a section of each part at `sectionZ`, default mid-height). Returns the path and size.",
    inputSchema: {
      type: "object",
      properties: {
        ...MODEL_PROPS,
        format: { type: "string", enum: [...FORMATS, "stp"], description: "Output format (default: from `path`'s extension)." },
        path: { type: "string", description: "Output file (relative to `baseDir` or cwd). Default <model>.<format> in cwd." },
        parts: { type: "array", items: { type: "string" }, description: "Only these parts / drawings." },
        tolerance: { type: "number", description: "Mesh chord tolerance, mm (default 0.01)." },
        sectionZ: { type: "number", description: "dxf/svg without drawings: slice height, mm." },
        dxfEntities: { type: "string", enum: ["primitives", "polyline"], description: "DXF: LINE/ARC/CIRCLE (default) or closed POLYLINEs with arc bulges." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (a) => serial(() => exportTool(a)),
  },
  {
    name: "tscad_pick_selectors",
    title: "Selectors for an edge or face",
    description:
      "Find the edge (or face) of a part nearest a point — or by index — and return selectors that pick it (string like \">Z and |X\" and builder code like edges.top().parallel(\"x\")), each with how many edges/faces it selects. Use it to write `edges=` for <fillet>/<chamfer> or `open=` for <shell>.",
    inputSchema: {
      type: "object",
      properties: {
        ...MODEL_PROPS,
        part: { type: "string", description: "Part name (default: the first part)." },
        kind: { type: "string", enum: ["edge", "face"], description: "Default edge." },
        point: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "A point [x, y, z] mm on or near the edge/face." },
        index: { type: "number", description: "The edge/face record index (instead of point)." },
      },
    },
    annotations: RO,
    run: (a) => serial(() => pickTool(a)),
  },
  {
    name: "tscad_check",
    title: "Check a tscad model",
    description:
      "Design checks on an evaluated model: 3D-printing overhangs (faces steeper than maxOverhangDeg from vertical, with where they are and a selector naming them), wall thickness (thinnest wall and where), bed fit, watertight meshes, and interference between parts (shared volume of each overlapping pair). Use it before exporting for printing or after building an assembly.",
    inputSchema: {
      type: "object",
      properties: {
        ...MODEL_PROPS,
        buildDir: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Print direction (default [0, 0, 1])." },
        maxOverhangDeg: { type: "number", description: "Steepest printable overhang, degrees from vertical (default 45)." },
        minWall: { type: "number", description: "Thinnest printable wall, mm (default 0.8)." },
        bed: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Build volume [x, y, z] mm." },
        interference: { type: "boolean", description: "Check part pairs for overlap (default true)." },
        minVolume: { type: "number", description: "Ignore overlaps smaller than this, mm³ (default 0.001)." },
        parts: { type: "array", items: { type: "string" }, description: "Only these parts." },
      },
    },
    annotations: RO,
    run: (a) => serial(() => checkTool(a)),
  },
  {
    name: "tscad_list_examples",
    title: "List tscad examples",
    description: "The bundled example models with a one-line summary each.",
    inputSchema: { type: "object", properties: {} },
    annotations: RO,
    run: listExamplesTool,
  },
  {
    name: "tscad_read_example",
    title: "Read a tscad example",
    description: "The full TSX source of a bundled example model (see tscad_list_examples) — good templates for params, components and parts.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Example name, e.g. \"bracket\"." } }, required: ["name"] },
    annotations: RO,
    run: readExampleTool,
  },
];
