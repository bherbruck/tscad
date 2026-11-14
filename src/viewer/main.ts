/**
 * The tscad viewer app: wires the dev-server socket, the eval worker, the 3D viewport and the
 * panels. Configured by `window.__TSCAD__` (the dev server injects it; a static playground can too).
 */
import { copyText, escapeHtml, h, icon, LOGO } from "./dom";
import { hashToValues, ParamsPanel, valuesToHash } from "./params";
import type { CodeFrame, EvalData, ExportFormat, FromWorker, Loc, ParamSchemaData, ParamValuesData, PartData, StageError, ToWorker } from "./protocol";
import { fmtNum, PALETTE, type Hit, type SectionAxis, type ViewName, Viewport } from "./scene";
import { describe, selectorAttr } from "./selectors";
import type { PickInfo } from "../ir";

interface Config {
  wasmUrl: string;
  glueUrl: string;
  workerUrl: string;
  /** WebSocket path of the dev server (omit for a static page). */
  ws?: string;
  /** A bundle to load straight away (static pages). */
  bundleUrl?: string;
  file?: string;
}

interface BundleError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  lineText?: string;
  lines?: [number, string][];
}

const cfg: Config = {
  wasmUrl: "/wasm/tscad_wasm_bg.wasm",
  glueUrl: "/wasm/tscad_wasm.js",
  workerUrl: "/__tscad/viewer/worker.js",
  ws: "/__ws",
  ...((window as any).__TSCAD__ ?? {}),
};

const FORMATS: { id: ExportFormat; name: string; desc: string; ext: string; mime: string }[] = [
  { id: "step", name: "STEP", desc: "Exact B-rep · CAD interchange", ext: "step", mime: "model/step" },
  { id: "stl", name: "STL", desc: "Binary mesh · 3D printing", ext: "stl", mime: "model/stl" },
  { id: "3mf", name: "3MF", desc: "Mesh with colours · slicers", ext: "3mf", mime: "model/3mf" },
  { id: "glb", name: "GLB", desc: "glTF binary · web & AR", ext: "glb", mime: "model/gltf-binary" },
  { id: "obj", name: "OBJ", desc: "Wavefront mesh", ext: "obj", mime: "model/obj" },
];

// ───────────────────────── state ─────────────────────────

const state = {
  data: undefined as EvalData | undefined,
  error: undefined as StageError | undefined,
  bundleErrors: [] as BundleError[],
  schema: {} as ParamSchemaData,
  values: hashToValues(location.hash) as ParamValuesData,
  file: cfg.file ?? "model.tsx",
  busy: "" as string,
  kernelReady: false,
  kernelVersion: "",
  bundleUrl: "",
  selection: undefined as { hit: Hit; info?: PickInfo; error?: string } | undefined,
  form: (localStorage.getItem("tscad.selectorForm") as "string" | "builder") ?? "string",
  measure: false,
  colors: {} as Record<string, string>,
  connected: false,
};

// ───────────────────────── layout ─────────────────────────

const app = document.getElementById("app")!;
const stage = h("div", { class: "stage" });
const viewport = new Viewport(stage);

const statusPill = h("div", { class: "status" });
const fileLabel = h("div", { class: "file" }, icon("file", 14), h("span", null, state.file));
const exportBtn = h("button", { class: "btn primary", title: "Export" }, icon("download", 15), h("span", null, "Export"), icon("chevron", 14));
const themeBtn = h("button", { class: "icon-btn", title: "Toggle theme" }, icon("sun"));
const helpBtn = h("button", { class: "icon-btn", title: "Keyboard shortcuts (?)" }, icon("help"));
const shotBtn = h("button", { class: "icon-btn", title: "Save screenshot" }, icon("camera"));
const panelsBtn = h("button", { class: "icon-btn only-narrow", title: "Panels" }, icon("panel"));

const topbar = h(
  "header",
  { class: "topbar" },
  h("div", { class: "brand", html: `${LOGO}<span>tscad</span>` }),
  h("div", { class: "sep" }),
  fileLabel,
  statusPill,
  h("div", { class: "spacer" }),
  panelsBtn,
  shotBtn,
  themeBtn,
  helpBtn,
  exportBtn,
);

const params = new ParamsPanel();
const paramsCard = card("Parameters", "sliders", params.el, [
  h("button", { class: "icon-btn sm", title: "Copy link with these parameters", onclick: () => copyLink() }, icon("link", 14)),
  h("button", { class: "icon-btn sm", title: "Reset all", onclick: () => params.reset() }, icon("reset", 14)),
]);
const partsList = h("div", { class: "parts" });
const partsCard = card("Parts", "layers", partsList);
const left = h("aside", { class: "side left" }, paramsCard, partsCard);

const inspectorBody = h("div", { class: "inspector" });
const inspectorCard = card("Selection", "cursor", inspectorBody, [h("button", { class: "icon-btn sm", title: "Clear (Esc)", onclick: () => select(undefined) }, icon("x", 14))]);
inspectorCard.classList.add("hidden");
const statsBody = h("div", { class: "stats" });
const statsCard = card("Model", "info", statsBody);
const right = h("aside", { class: "side right" }, inspectorCard, statsCard);

const errorBox = h("div", { class: "error-box hidden" });
const toasts = h("div", { class: "toasts" });
const gizmo = h("div", { class: "gizmo" });
const hoverTip = h("div", { class: "hover-tip hidden" });
const loader = h("div", { class: "loader" }, h("div", { class: "loader-mark", html: LOGO }), h("div", { class: "loader-text" }, "Starting kernel…"), h("div", { class: "loader-bar" }, h("i")));

// Bottom toolbar
const tb = {
  iso: tool("cube", "Isometric (1)", () => viewport.setView("iso"), "Iso"),
  top: tool("", "Top (2)", () => viewport.setView("top"), "Top"),
  front: tool("", "Front (3)", () => viewport.setView("front"), "Front"),
  right: tool("", "Right (4)", () => viewport.setView("right"), "Right"),
  fit: tool("fit", "Fit to view (F)", () => viewport.fit()),
  ortho: tool("square", "Orthographic (O)", () => toggleOrtho()),
  edges: tool("edges", "Edges (E)", () => toggleEdges()),
  wire: tool("wire", "Wireframe (W)", () => toggleWire()),
  xray: tool("xray", "X-ray (T)", () => toggleXray()),
  section: tool("section", "Section (X)", () => toggleSection()),
  measure: tool("ruler", "Measure (M)", () => toggleMeasure()),
};
tb.edges.classList.add("active");
const sectionPop = buildSectionPopover();
const toolbar = h(
  "div",
  { class: "toolbar" },
  h("div", { class: "tool-group" }, tb.iso, tb.top, tb.front, tb.right),
  h("div", { class: "tool-sep" }),
  h("div", { class: "tool-group" }, tb.fit, tb.ortho),
  h("div", { class: "tool-sep" }),
  h("div", { class: "tool-group" }, tb.edges, tb.wire, tb.xray, tb.section, tb.measure),
);
const exportMenu = buildExportMenu();
const helpPop = buildHelp();

stage.append(gizmo, hoverTip);
app.append(topbar, h("main", { class: "workspace" }, stage, left, right, h("div", { class: "bottom" }, sectionPop, errorBox, toolbar), toasts, exportMenu, helpPop), loader);

function card(title: string, ico: string, body: HTMLElement, actions: HTMLElement[] = []) {
  const head = h("div", { class: "card-head" }, icon(ico, 14), h("span", { class: "card-title" }, title), h("div", { class: "spacer" }), ...actions);
  const c = h("section", { class: "card" }, head, h("div", { class: "card-body" }, body));
  head.addEventListener("dblclick", () => c.classList.toggle("collapsed"));
  return c;
}

function tool(ico: string, title: string, onclick: () => void, label?: string) {
  return h("button", { class: `tool${label ? " text" : ""}`, title, onclick, "aria-label": title }, ico ? icon(ico, 17) : null, label ? h("span", null, label) : null);
}

// ───────────────────────── theme ─────────────────────────

function setTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeBtn.replaceChildren(icon(dark ? "sun" : "moon"));
  viewport.setTheme(dark);
  localStorage.setItem("tscad.theme", dark ? "dark" : "light");
}
setTheme((localStorage.getItem("tscad.theme") ?? "dark") === "dark");
themeBtn.onclick = () => setTheme(document.documentElement.dataset.theme !== "dark");
panelsBtn.onclick = () => app.classList.toggle("panels-open");

// ───────────────────────── worker ─────────────────────────

const worker = new Worker(cfg.workerUrl, { type: "module" });
let inFlight = false;
let queuedValues: ParamValuesData | undefined;
let reqId = 0;
const pending = new Map<number, (m: any) => void>();

function send(msg: ToWorker) {
  worker.postMessage(msg);
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  switch (m.type) {
    case "ready":
      state.kernelReady = true;
      state.kernelVersion = m.version;
      loader.querySelector(".loader-text")!.textContent = "Evaluating model…";
      console.info(`[tscad] kernel ${m.version} ready in ${m.loadMs.toFixed(0)} ms`);
      if (state.bundleUrl) loadBundle(state.bundleUrl);
      break;
    case "busy":
      state.busy = m.stage;
      renderStatus();
      break;
    case "result":
      onResult(m.data);
      settle();
      break;
    case "error":
      state.error = m.error;
      if (m.schema && Object.keys(m.schema).length) {
        state.schema = m.schema;
        params.update(m.schema, { ...m.values, ...state.values });
      }
      state.busy = "";
      hideLoader();
      renderError();
      renderStatus();
      viewport.setParts([...viewport.parts.keys()].map((name) => ({ name, failed: true })));
      settle();
      break;
    case "pick":
    case "export":
      pending.get(m.id)?.(m);
      pending.delete(m.id);
      break;
  }
};
worker.onerror = (e) => {
  state.error = { stage: "worker", message: e.message || "The eval worker failed to start." };
  hideLoader();
  renderError();
};

function settle() {
  inFlight = false;
  if (queuedValues) {
    const v = queuedValues;
    queuedValues = undefined;
    runParams(v);
  }
}

function runParams(values: ParamValuesData) {
  if (!state.bundleUrl) return;
  if (inFlight) {
    queuedValues = values;
    return;
  }
  inFlight = true;
  send({ type: "params", values });
}

function loadBundle(url: string) {
  state.bundleUrl = url;
  if (!state.kernelReady) return;
  inFlight = true;
  queuedValues = undefined;
  send({ type: "load", url, values: state.values });
}

type Req = Extract<ToWorker, { id: number }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
function request<T>(msg: DistributiveOmit<Req, "id">): Promise<T> {
  const id = ++reqId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ ...(msg as any), id });
  });
}

send({ type: "init", wasmUrl: cfg.wasmUrl, glueUrl: cfg.glueUrl });

// ───────────────────────── results ─────────────────────────

function onResult(data: EvalData) {
  const first = !state.data;
  state.data = data;
  state.busy = "";
  state.schema = data.schema;
  state.values = { ...data.values };
  const failed = data.parts.filter((p) => !p.ok);
  state.error = failed.length ? kernelError(failed[0]!) : undefined;
  params.update(data.schema, data.values);
  viewport.setParts(
    data.parts.map((p, i) => ({ name: p.name, color: state.colors[p.name] ?? p.color ?? PALETTE[i % PALETTE.length], mesh: p.mesh, failed: !p.ok })),
  );
  renderParts();
  renderStats();
  renderError();
  renderStatus();
  hideLoader();
  if (first) viewport.setView("iso", false);
}

function kernelError(p: PartData): StageError {
  const e = p.error!;
  return { stage: "kernel", message: `${e.op}: ${e.message}`, loc: e.loc, frame: e.frame, stack: `part "${p.name}" · node ${e.path}` };
}

function hideLoader() {
  loader.classList.add("done");
}

// ───────────────────────── status / stats ─────────────────────────

function renderStatus() {
  const d = state.data;
  let cls = "ok", text = "";
  if (!state.connected && cfg.ws) {
    cls = "warn";
    text = "Disconnected";
  } else if (state.busy) {
    cls = "busy";
    text = state.busy === "loading" ? "Loading…" : state.busy === "rendering" ? "Rendering…" : "Evaluating…";
  } else if (state.bundleErrors.length) {
    cls = "err";
    text = "Build error";
  } else if (state.error) {
    cls = "err";
    text = state.error.stage === "kernel" ? "Kernel error" : state.error.stage === "render" ? "Render error" : "Error";
  } else if (d) {
    const cached = d.cacheMisses === 0 && d.cacheHits > 0;
    text = `${fmtMs(d.timings.total)}${cached ? " · cached" : ""}`;
    cls = cached ? "ok cached" : "ok";
  } else {
    cls = "busy";
    text = "Starting…";
  }
  statusPill.className = `status ${cls}`;
  statusPill.replaceChildren(
    cls.startsWith("ok") ? icon(cls.includes("cached") ? "zap" : "check", 12) : cls === "err" ? icon("alert", 12) : h("i", { class: "dot" }),
    h("span", null, text),
  );
}

function fmtMs(ms: number) {
  return ms < 10 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function fmtVol(mm3: number) {
  return mm3 >= 1e5 ? `${fmtNum(mm3 / 1000)} cm³` : `${fmtNum(mm3)} mm³`;
}

function fmtMass(g: number) {
  return g >= 1000 ? `${fmtNum(g / 1000)} kg` : `${fmtNum(g)} g`;
}

function renderStats() {
  const d = state.data;
  statsBody.replaceChildren();
  if (!d) return void statsBody.append(h("div", { class: "empty" }, "No model evaluated yet."));
  const ok = d.parts.filter((p) => p.ok && !p.empty);
  const totalVol = ok.reduce((s, p) => s + (p.volume ?? 0), 0);
  const tris = ok.reduce((s, p) => s + (p.mesh ? p.mesh.indices.length / 3 : 0), 0);
  const box = viewport.bounds;
  const size = ok.length ? [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z] : [NaN, NaN, NaN];
  const masses = ok.filter((p) => p.density !== undefined);
  const mass = masses.reduce((s, p) => s + ((p.volume ?? 0) / 1000) * p.density!, 0);
  const cached = d.cacheMisses === 0 && d.cacheHits > 0;

  statsBody.append(
    h(
      "div",
      { class: "kpis" },
      kpi("Volume", fmtVol(totalVol)),
      masses.length ? kpi("Mass", fmtMass(mass)) : kpi("Parts", String(d.parts.length)),
      kpi("Size", size.map((v) => fmtNum(v, 1)).join(" × "), "mm"),
    ),
    h(
      "div",
      { class: "timing" },
      h("div", { class: "timing-bar" }, ...(["render", "kernel", "mesh"] as const).map((k) => h("i", { class: k, style: { flexGrow: String(Math.max(d.timings[k], 0.01)) }, title: `${k}: ${fmtMs(d.timings[k])}` }))),
      h(
        "div",
        { class: "timing-legend" },
        h("span", { class: "render" }, `jsx ${fmtMs(d.timings.render)}`),
        h("span", { class: "kernel" }, `kernel ${fmtMs(d.timings.kernel)}`),
        h("span", { class: "mesh" }, `mesh ${fmtMs(d.timings.mesh)}`),
        cached ? h("span", { class: "cache-badge" }, icon("zap", 11), "cached") : h("span", { class: "muted" }, `${d.cacheHits}/${d.cacheHits + d.cacheMisses} cache hits`),
      ),
    ),
    h("div", { class: "stat-rows" }, row("Triangles", tris.toLocaleString()), row("Kernel", state.kernelVersion ? `solidcore ${state.kernelVersion}` : "—")),
  );
  for (const w of d.warnings) statsBody.append(h("div", { class: "warning" }, icon("alert", 12), w));
}

function kpi(label: string, value: string, unit?: string) {
  return h("div", { class: "kpi" }, h("div", { class: "kpi-label" }, label), h("div", { class: "kpi-value" }, value, unit ? h("small", null, ` ${unit}`) : null));
}

function row(k: string, v: string | HTMLElement) {
  return h("div", { class: "stat-row" }, h("span", null, k), h("b", null, v));
}

// ───────────────────────── parts ─────────────────────────

let isolated: string | undefined;

function renderParts() {
  const d = state.data;
  partsList.replaceChildren();
  if (!d) return void partsList.append(h("div", { class: "empty pad" }, "Parts appear here once the model builds."));
  d.parts.forEach((p, i) => {
    const view = viewport.parts.get(p.name);
    const color = state.colors[p.name] ?? p.color ?? PALETTE[i % PALETTE.length]!;
    const visible = view ? view.visible : true;
    const swatch = h("input", { type: "color", value: toHexColor(color), class: "swatch-input", title: "Display colour" }) as HTMLInputElement;
    swatch.addEventListener("input", () => {
      state.colors[p.name] = swatch.value;
      (swatch.parentElement as HTMLElement).style.setProperty("--c", swatch.value);
      viewport.setPartColor(p.name, swatch.value);
    });
    const eye = h("button", { class: "icon-btn sm", title: visible ? "Hide" : "Show", onclick: () => { viewport.setPartVisible(p.name, !(viewport.parts.get(p.name)?.visible ?? true)); isolated = undefined; renderParts(); } }, icon(visible ? "eye" : "eyeOff", 14));
    const iso = h("button", { class: `icon-btn sm${isolated === p.name ? " active" : ""}`, title: "Isolate", onclick: () => isolate(p.name) }, icon("target", 14));
    const meta: string[] = [];
    if (p.ok && p.volume !== undefined) meta.push(fmtVol(p.volume));
    if (p.ok && p.density !== undefined && p.volume !== undefined) meta.push(fmtMass((p.volume / 1000) * p.density));
    if (p.counts) meta.push(`${p.counts[0]}F ${p.counts[1]}E`);
    const el = h(
      "div",
      { class: `part${visible ? "" : " hidden-part"}${p.ok ? "" : " failed"}` },
      h("label", { class: "swatch", style: { "--c": color } as any }, swatch),
      h(
        "div",
        { class: "part-main" },
        h("div", { class: "part-name" }, p.name, p.cached ? h("span", { class: "cache-chip", title: "From the kernel cache" }, icon("zap", 10)) : null, p.material ? h("span", { class: "chip" }, p.material) : null),
        h("div", { class: "part-meta" }, p.ok ? meta.join(" · ") : p.error ? `${p.error.op} failed` : "failed"),
      ),
      h("div", { class: "part-actions" }, iso, eye),
    );
    el.addEventListener("mouseenter", () => p.bbox && el.classList.add("hover"));
    el.addEventListener("mouseleave", () => el.classList.remove("hover"));
    el.title = p.bbox ? `${p.name}\nbbox ${p.bbox[0].map((v) => fmtNum(v)).join(", ")} → ${p.bbox[1].map((v) => fmtNum(v)).join(", ")}\n${p.counts ? `${p.counts[0]} faces, ${p.counts[1]} edges, ${p.counts[2]} vertices` : ""}\n${fmtMs(p.millis)}` : p.name;
    partsList.append(el);
  });
}

function isolate(name: string) {
  const d = state.data;
  if (!d) return;
  isolated = isolated === name ? undefined : name;
  for (const p of d.parts) viewport.setPartVisible(p.name, !isolated || p.name === isolated);
  renderParts();
  viewport.fit();
}

function toHexColor(c: string): string {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = c;
  const v = ctx.fillStyle;
  return v.startsWith("#") ? v : "#888888";
}

// ───────────────────────── errors ─────────────────────────

function renderError() {
  errorBox.replaceChildren();
  const be = state.bundleErrors;
  if (!be.length && !state.error) {
    errorBox.classList.add("hidden");
    return;
  }
  errorBox.classList.remove("hidden");
  if (be.length) {
    const e = be[0]!;
    errorBox.append(errorHead("Build failed", e.message, e.file ? { file: e.file, line: e.line ?? 1, column: e.column ?? 1 } : undefined));
    if (e.line && (e.lines?.length || e.lineText !== undefined)) errorBox.append(frameEl({ file: e.file ?? "", line: e.line, column: e.column ?? 1, lines: e.lines?.length ? e.lines : [[e.line, e.lineText!]] }));
    if (be.length > 1) errorBox.append(h("div", { class: "err-more" }, `+${be.length - 1} more`));
    return;
  }
  const e = state.error!;
  const title = { import: "Module failed to load", render: "Render failed", kernel: "Kernel error", worker: "Worker error" }[e.stage];
  errorBox.append(errorHead(title, e.message, e.loc));
  if (e.frame) errorBox.append(frameEl(e.frame));
  if (e.stage === "kernel" && e.stack) errorBox.append(h("div", { class: "err-path" }, e.stack));
  else if (e.stack && !e.frame) errorBox.append(h("pre", { class: "err-stack" }, e.stack.split("\n").slice(0, 6).join("\n")));
  if (e.stage === "kernel" && state.data?.parts.some((p) => !p.ok && viewport.parts.has(p.name))) errorBox.append(h("div", { class: "err-hint" }, "Showing the last good geometry in red."));
}

function errorHead(title: string, message: string, loc?: Loc) {
  return h(
    "div",
    { class: "err-head" },
    icon("alert", 16),
    h("div", { class: "err-text" }, h("div", { class: "err-title" }, title, loc ? h("span", { class: "err-loc" }, `${shortFile(loc.file)}:${loc.line}:${loc.column}`) : null), h("div", { class: "err-msg" }, message)),
    h("button", { class: "icon-btn sm", title: "Dismiss", onclick: () => errorBox.classList.add("hidden") }, icon("x", 14)),
  );
}

function frameEl(f: CodeFrame) {
  const pre = h("pre", { class: "code-frame" });
  const width = String(f.lines[f.lines.length - 1]?.[0] ?? 0).length;
  for (const [n, text] of f.lines) {
    const hot = n === f.line;
    pre.append(h("div", { class: `cf-line${hot ? " hot" : ""}` }, h("span", { class: "cf-n" }, String(n).padStart(width)), h("span", { class: "cf-t", html: highlightTsx(text) })));
    if (hot) pre.append(h("div", { class: "cf-caret" }, h("span", { class: "cf-n" }, " ".repeat(width)), h("span", null, " ".repeat(Math.max(0, f.column - 1)) + "^")));
  }
  return pre;
}

function shortFile(f: string) {
  return f.replace(/^.*?:\/\/[^/]+/, "").replace(/^\.?\//, "");
}

/** A light TSX highlighter for code frames. */
function highlightTsx(src: string): string {
  const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[a-zA-Z][\w.]*)|\b(const|let|var|function|return|export|default|import|from|if|else|for|of|in|new|type|interface)\b|\b(\d+(?:\.\d+)?)\b/g;
  let out = "", last = 0;
  for (const m of src.matchAll(re)) {
    out += escapeHtml(src.slice(last, m.index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "t" : m[4] ? "k" : "n";
    out += `<span class="tk-${cls}">${escapeHtml(m[0])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + escapeHtml(src.slice(last));
}

// ───────────────────────── params ─────────────────────────

let hashTimer = 0;
params.onChange = (values) => {
  state.values = values;
  runParams(values);
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const hash = valuesToHash(state.schema, values);
    history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
  }, 150);
};

window.addEventListener("hashchange", () => {
  const v = { ...state.values, ...hashToValues(location.hash, state.schema) };
  params.update(state.schema, v);
  state.values = v;
  runParams(v);
});

async function copyLink() {
  const hash = valuesToHash(state.schema, state.values);
  const url = `${location.origin}${location.pathname}${hash ? `#${hash}` : ""}`;
  if (await copyText(url)) toast("Link copied — it reproduces these parameters");
}

// ───────────────────────── picking ─────────────────────────

let hoverFrame = 0;
let lastMove: PointerEvent | undefined;
let downAt: { x: number; y: number; t: number } | undefined;

viewport.canvas.addEventListener("pointermove", (e) => {
  lastMove = e;
  if (e.buttons) {
    hoverTip.classList.add("hidden");
    return;
  }
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const ev = lastMove!;
    const hit = viewport.hitTest(ev.clientX, ev.clientY);
    viewport.setHover(hit);
    viewport.canvas.style.cursor = hit ? (state.measure ? "crosshair" : "pointer") : state.measure ? "crosshair" : "";
    if (hit) {
      const r = stage.getBoundingClientRect();
      hoverTip.classList.remove("hidden");
      hoverTip.textContent = state.measure ? `${fmtNum(hit.point.x)}, ${fmtNum(hit.point.y)}, ${fmtNum(hit.point.z)}` : `${hit.kind} ${hit.index} · ${hit.part}`;
      hoverTip.style.transform = `translate(${ev.clientX - r.left + 14}px, ${ev.clientY - r.top + 16}px)`;
    } else hoverTip.classList.add("hidden");
  });
});
viewport.canvas.addEventListener("pointerleave", () => {
  viewport.setHover(undefined);
  hoverTip.classList.add("hidden");
});
viewport.canvas.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
viewport.canvas.addEventListener("pointerup", (e) => {
  if (!downAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = undefined;
  if (moved > 4) return;
  if (state.measure) {
    const p = viewport.measurePoint(e.clientX, e.clientY);
    if (!p) return;
    const res = viewport.addMeasurePoint(p);
    if (res) toast(`Distance ${fmtNum(res.a.distanceTo(res.b), 3)} mm`);
    return;
  }
  select(viewport.hitTest(e.clientX, e.clientY));
});
viewport.canvas.addEventListener("dblclick", (e) => {
  if (!viewport.hitTest(e.clientX, e.clientY)) viewport.fit();
});

async function select(hit: Hit | undefined) {
  viewport.setSelection(hit);
  if (!hit) {
    state.selection = undefined;
    renderInspector();
    return;
  }
  state.selection = { hit };
  renderInspector();
  const res = await request<{ info?: PickInfo; error?: string }>({ type: "pick", kind: hit.kind, part: hit.part, index: hit.index });
  if (state.selection?.hit !== hit) return;
  state.selection.info = res.info;
  state.selection.error = res.error;
  renderInspector();
}

function renderInspector() {
  const s = state.selection;
  inspectorCard.classList.toggle("hidden", !s);
  inspectorBody.replaceChildren();
  if (!s) return;
  const { hit, info } = s;
  const noun = hit.kind === "edge" ? "edges" : "faces";
  const kindLabel = info?.kind ?? "…";
  inspectorBody.append(
    h(
      "div",
      { class: "sel-head" },
      h("span", { class: `badge ${hit.kind}` }, hit.kind),
      h("span", { class: "sel-kind" }, kindLabel),
      info?.radius !== undefined ? h("span", { class: "chip" }, `r ${fmtNum(info.radius, 3)}`) : null,
      h("span", { class: "spacer" }),
      h("span", { class: "muted" }, hit.part),
    ),
  );
  const facts: [string, string][] = [];
  if (info?.direction) facts.push([hit.kind === "face" ? "Normal" : "Direction", info.direction.map((v) => fmtNum(v, 3)).join(", ")]);
  if (info?.kind === "line" && info.points.length >= 2) {
    const a = info.points[0]!, b = info.points[info.points.length - 1]!;
    facts.push(["Length", `${fmtNum(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), 3)} mm`]);
  }
  facts.push(["Picked at", [hit.point.x, hit.point.y, hit.point.z].map((v) => fmtNum(v)).join(", ")]);
  inspectorBody.append(h("div", { class: "stat-rows" }, ...facts.map(([k, v]) => row(k, v))));
  if (s.error) {
    inspectorBody.append(h("div", { class: "warning" }, icon("alert", 12), s.error));
    return;
  }
  if (!info) {
    inspectorBody.append(h("div", { class: "skeleton" }), h("div", { class: "skeleton" }));
    return;
  }
  const formToggle = h(
    "div",
    { class: "segmented sm" },
    ...(["string", "builder"] as const).map((f) =>
      h("button", { class: state.form === f ? "active" : "", onclick: () => { state.form = f; localStorage.setItem("tscad.selectorForm", f); renderInspector(); } }, f === "string" ? '"string"' : "builder"),
    ),
  );
  inspectorBody.append(h("div", { class: "sel-sub" }, h("span", null, "Selectors"), h("span", { class: "spacer" }), formToggle));
  const list = h("div", { class: "selectors" });
  // A selector that matches nothing can't be pasted usefully; keep the rest in kernel order.
  const suggestions = info.suggestions.filter((x) => x.count > 0);
  suggestions.forEach((sug, i) => {
    const attr = selectorAttr(sug.selector, noun, state.form);
    const exact = sug.count === 1;
    const item = h(
      "button",
      { class: `selector${i === 0 ? " best" : ""}`, title: "Copy" },
      h("code", { html: highlightTsx(attr) }),
      h("div", { class: "selector-meta" }, h("span", null, describe(sug.selector, noun)), h("span", { class: `count${exact ? " exact" : ""}` }, `${sug.count} ${sug.count === 1 ? noun.replace(/s$/, "") : noun}`)),
      h("span", { class: "copy" }, icon("copy", 13)),
    );
    item.onclick = async () => {
      if (await copyText(attr)) {
        item.classList.add("copied");
        setTimeout(() => item.classList.remove("copied"), 900);
        toast(`Copied ${attr}`);
      }
    };
    list.append(item);
  });
  inspectorBody.append(list);
  const best = suggestions[0];
  if (best) {
    const op = hit.kind === "edge" ? `<fillet radius={1} ${selectorAttr(best.selector, noun, state.form)}>` : `<shell thickness={2} ${selectorAttr(best.selector, noun, state.form)}>`;
    inspectorBody.append(h("div", { class: "snippet" }, h("code", { html: highlightTsx(op) }), h("button", { class: "icon-btn sm", title: "Copy snippet", onclick: async () => (await copyText(op)) && toast("Snippet copied") }, icon("copy", 13))));
  }
}

// ───────────────────────── toolbar actions ─────────────────────────

function toggleOrtho() {
  viewport.setOrtho(!viewport.isOrtho);
  tb.ortho.classList.toggle("active", viewport.isOrtho);
  tb.ortho.replaceChildren(icon(viewport.isOrtho ? "square" : "square", 17));
  toast(viewport.isOrtho ? "Orthographic" : "Perspective");
}
function toggleEdges() {
  viewport.showEdges = !viewport.showEdges;
  tb.edges.classList.toggle("active", viewport.showEdges);
  viewport.restyle();
}
function toggleWire() {
  viewport.wireframe = !viewport.wireframe;
  tb.wire.classList.toggle("active", viewport.wireframe);
  viewport.restyle();
}
function toggleXray() {
  viewport.xray = !viewport.xray;
  tb.xray.classList.toggle("active", viewport.xray);
  viewport.restyle();
}
function toggleSection() {
  const on = !viewport.section.enabled;
  viewport.setSection({ enabled: on });
  tb.section.classList.toggle("active", on);
  sectionPop.classList.toggle("hidden", !on);
}
function toggleMeasure() {
  state.measure = !state.measure;
  tb.measure.classList.toggle("active", state.measure);
  if (!state.measure) viewport.clearMeasure();
  else toast("Click two points to measure · Esc to clear");
}

function buildSectionPopover() {
  const axes = (["x", "y", "z"] as SectionAxis[]).map((a) =>
    h("button", { class: a === "z" ? "active" : "", onclick: () => { viewport.setSection({ axis: a }); axes.forEach((b) => b.classList.toggle("active", b.textContent === a.toUpperCase())); } }, a.toUpperCase()),
  );
  const slider = h("input", { type: "range", min: 0, max: 1, step: 0.001, value: "0.5" }) as HTMLInputElement;
  const paint = () => slider.style.setProperty("--fill", `${Number(slider.value) * 100}%`);
  paint();
  slider.addEventListener("input", () => {
    paint();
    viewport.setSection({ offset: Number(slider.value) });
  });
  const flip = h("button", { class: "icon-btn sm", title: "Flip side", onclick: () => viewport.setSection({ flip: !viewport.section.flip }) }, icon("flip", 14));
  return h("div", { class: "section-pop hidden" }, icon("section", 15), h("div", { class: "segmented sm" }, ...axes), slider, flip);
}

// ───────────────────────── export ─────────────────────────


function buildExportMenu() {
  let tol = 0.01;
  const tolSeg = h(
    "div",
    { class: "segmented sm" },
    ...[
      ["Draft", 0.1],
      ["Normal", 0.01],
      ["Fine", 0.002],
    ].map(([label, v]) => h("button", { class: v === tol ? "active" : "", onclick: (e: Event) => { tol = v as number; for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.classList.toggle("active", b === e.currentTarget); } }, String(label))),
  );
  const menu = h(
    "div",
    { class: "menu export-menu hidden" },
    ...FORMATS.map((f) =>
      h(
        "button",
        { class: "menu-item", onclick: () => doExport(f, tol) },
        h("span", { class: `fmt fmt-${f.id}` }, f.name),
        h("span", { class: "menu-desc" }, f.desc),
        h("span", { class: "kbd-hint" }, `.${f.ext}`),
      ),
    ),
    h("div", { class: "menu-foot" }, h("span", null, "Mesh tolerance"), tolSeg),
  );
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
    helpPop.classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target as Node)) menu.classList.add("hidden");
  });
  return menu;
}

async function doExport(f: (typeof FORMATS)[number], tolerance: number) {
  exportMenu.classList.add("hidden");
  const d = state.data;
  if (!d) return toast("Nothing to export yet");
  const parts = d.parts.filter((p) => p.ok && !p.empty && (viewport.parts.get(p.name)?.visible ?? true)).map((p) => ({ name: p.name, color: state.colors[p.name] ?? p.color }));
  if (!parts.length) return toast("No visible parts to export");
  const t = performance.now();
  const done = toast(`Exporting ${f.name}…`, true);
  const res = await request<{ data?: Uint8Array | string; error?: string }>({ type: "export", format: f.id, parts, tolerance });
  done();
  if (res.error || res.data === undefined) return toast(`Export failed: ${res.error}`);
  const base = state.file.replace(/^.*\//, "").replace(/\.[jt]sx?$/, "");
  const name = parts.length === 1 && d.parts.length > 1 ? `${base}-${parts[0]!.name}` : base;
  const blob = new Blob([res.data as BlobPart], { type: f.mime });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${name}.${f.ext}` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`${name}.${f.ext} · ${fmtBytes(blob.size)} · ${fmtMs(performance.now() - t)}`);
}

function fmtBytes(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(1)} kB`;
}

shotBtn.onclick = () => {
  const a = h("a", { href: viewport.screenshot(), download: `${state.file.replace(/^.*\//, "").replace(/\.[jt]sx?$/, "")}.png` });
  a.click();
};

// ───────────────────────── help / keys ─────────────────────────

function buildHelp() {
  const keys: [string, string][] = [
    ["F", "Fit to view"],
    ["1 2 3 4", "Iso · Top · Front · Right"],
    ["O", "Orthographic / perspective"],
    ["E", "Toggle edges"],
    ["W", "Toggle wireframe"],
    ["T", "X-ray"],
    ["X", "Section plane"],
    ["M", "Measure"],
    ["Click", "Select face / edge → selectors"],
    ["Double-click", "Fit (on empty space)"],
    ["Esc", "Clear selection / measure"],
    ["?", "This help"],
  ];
  const pop = h(
    "div",
    { class: "menu help-pop hidden" },
    h("div", { class: "menu-title" }, "Keyboard shortcuts"),
    ...keys.map(([k, d]) => h("div", { class: "help-row" }, h("span", null, d), h("span", { class: "keys" }, ...k.split(" ").map((x) => h("kbd", null, x))))),
    h("div", { class: "menu-foot muted" }, "Drag to orbit · right-drag to pan · scroll to zoom"),
  );
  helpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.toggle("hidden");
    exportMenu.classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!pop.contains(e.target as Node)) pop.classList.add("hidden");
  });
  return pop;
}

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
  const views: Record<string, ViewName> = { "1": "iso", "2": "top", "3": "front", "4": "right", "5": "back", "6": "left", "7": "bottom" };
  if (views[e.key]) return viewport.setView(views[e.key]!);
  switch (e.key.toLowerCase()) {
    case "f":
      return viewport.fit();
    case "o":
      return toggleOrtho();
    case "e":
      return toggleEdges();
    case "w":
      return toggleWire();
    case "t":
      return toggleXray();
    case "x":
      return toggleSection();
    case "m":
      return toggleMeasure();
    case "?":
      return helpPop.classList.toggle("hidden");
    case "escape":
      helpPop.classList.add("hidden");
      exportMenu.classList.add("hidden");
      if (viewport.measureCount) return viewport.clearMeasure();
      return select(undefined);
  }
});

// ───────────────────────── toasts ─────────────────────────

function toast(text: string, sticky = false): () => void {
  const el = h("div", { class: "toast" }, text);
  toasts.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  const close = () => {
    el.classList.remove("in");
    setTimeout(() => el.remove(), 250);
  };
  if (!sticky) setTimeout(close, 2200);
  return close;
}

// ───────────────────────── gizmo ─────────────────────────

function drawGizmo() {
  const ax = viewport.axesOnScreen();
  const R = 34, C = 46;
  const items = (["x", "y", "z"] as const).flatMap((k) => {
    const [x, y, z] = ax[k];
    return [
      { k, neg: false, x: C + x * R, y: C + y * R, z },
      { k, neg: true, x: C - x * R, y: C - y * R, z: -z },
    ];
  });
  items.sort((a, b) => a.z - b.z);
  const color = { x: "var(--axis-x)", y: "var(--axis-y)", z: "var(--axis-z)" };
  const view: Record<string, ViewName> = { x: "right", "-x": "left", y: "back", "-y": "front", z: "top", "-z": "bottom" };
  gizmo.innerHTML = `<svg width="92" height="92" viewBox="0 0 92 92">
    <circle cx="${C}" cy="${C}" r="44" class="gz-bg"/>
    ${items
      .map((it) => {
        const c = color[it.k];
        const id = `${it.neg ? "-" : ""}${it.k}`;
        return it.neg
          ? `<g class="gz-hit" data-view="${view[id]}"><circle cx="${it.x}" cy="${it.y}" r="7" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-opacity=".6"/></g>`
          : `<line x1="${C}" y1="${C}" x2="${it.x}" y2="${it.y}" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><g class="gz-hit" data-view="${view[id]}"><circle cx="${it.x}" cy="${it.y}" r="9" fill="${c}"/><text x="${it.x}" y="${it.y + 3.6}" text-anchor="middle">${it.k.toUpperCase()}</text></g>`;
      })
      .join("")}
  </svg>`;
}
gizmo.addEventListener("click", (e) => {
  const g = (e.target as Element).closest("[data-view]");
  if (g) viewport.setView(g.getAttribute("data-view") as ViewName);
});
let gizmoFrame = 0;
viewport.onViewChange = () => {
  if (gizmoFrame) return;
  gizmoFrame = requestAnimationFrame(() => {
    gizmoFrame = 0;
    drawGizmo();
  });
};
drawGizmo();

// ───────────────────────── dev server socket ─────────────────────────

function connect() {
  if (!cfg.ws) {
    state.connected = true;
    if (cfg.bundleUrl) loadBundle(cfg.bundleUrl);
    return;
  }
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${cfg.ws}`);
  ws.onopen = () => {
    state.connected = true;
    renderStatus();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "bundle") {
      state.bundleErrors = [];
      if (m.file) {
        state.file = m.file;
        fileLabel.querySelector("span")!.textContent = m.file;
        document.title = `${m.file} · tscad`;
      }
      loadBundle(m.url);
      renderError();
    } else if (m.type === "building") {
      state.busy = "loading";
      renderStatus();
    } else if (m.type === "bundle-error") {
      state.bundleErrors = m.errors;
      state.busy = "";
      hideLoader();
      renderError();
      renderStatus();
    } else if (m.type === "reload-viewer") {
      location.reload();
    }
  };
  ws.onclose = () => {
    state.connected = false;
    renderStatus();
    setTimeout(connect, 1000);
  };
}
connect();
renderStatus();
renderParts();
renderStats();

// For tests and debugging.
(window as any).__tscadViewer = { state, viewport, select, request };
