/**
 * The tscad viewer app: wires the dev-server socket, the eval worker, the 3D viewport and the
 * panels. Configured by `window.__TSCAD__` (the dev server injects it; a static playground can too).
 */
import { copyText, h, icon, LOGO } from "./dom";
import { hashToValues, ParamsPanel, valuesToHash } from "./params";
import type { EvalData, FromWorker, Loc, ParamSchemaData, ParamValuesData, PartData, StageError, ToWorker } from "./protocol";
import { fmtNum, PALETTE, type Hit, type ViewName, Viewport } from "./scene";
import { SketchOverlay } from "./sketch-overlay";
import { AssemblyOverlay } from "./assembly-overlay";
import { RemoteWorker } from "./remote";
import { CheckOverlay, type CheckMode } from "./check-overlay";
import { DiffOverlay } from "./diff-overlay";
import { PlateOverlay } from "./plate-overlay";
import type { PlateData } from "./protocol";
import type { DiffData } from "./protocol";
import type { MateData, SketchChange, SketchData, SketchDimensionData } from "./protocol";
import type { PickInfo } from "../ir";
import { installErrors } from "./ui/errors";
import { installInspector } from "./ui/inspector";
import { installStats } from "./ui/stats";
import { installParts } from "./ui/parts";
import { installPlatePanel } from "./ui/plate-panel";
import { installDiffPanel } from "./ui/diff-panel";
import { installSketchDrag } from "./ui/sketch-drag";
import { installChecksPanel } from "./ui/checks-panel";
import { installExportMenu } from "./ui/export-menu";
import { fmtMs, shortFile } from "./ui/format";
import { installToolbar } from "./ui/toolbar";
import { installHelp } from "./ui/help";
import { installGizmo } from "./ui/gizmo";
import { installPointer } from "./ui/pointer";
import type { ViewerContext, ViewerState } from "./ui/context";

/** How the viewer is hosted: where it gets models and where it sends edits. */
export interface ViewerConfig {
  wasmUrl: string;
  glueUrl: string;
  workerUrl: string;
  /** WebSocket path of the dev server (omit for a static page). */
  ws?: string;
  /** A bundle to load straight away (static pages). */
  bundleUrl?: string;
  file?: string;
  /** Extra controls for the top bar (after the status pill). */
  topbarExtras?: HTMLElement[];
  /** A pane to the left of the 3D workspace (the playground's editor). */
  sidePane?: HTMLElement;
  /** Errors changed (undefined = none); for editor squiggles. */
  onErrors?: (error: StageError | undefined, bundleErrors: BundleError[], data?: EvalData) => void;
  /** Hash keys the viewer must leave alone (besides params). */
  hashKeep?: string[];
  /**
   * A sketch chip or dimension label was clicked: reveal `loc` in the code. Default: show
   * file:line and copy it.
   */
  onSourceClick?: (loc: Loc, target: { kind: "sketch"; sketch: SketchData } | { kind: "dimension"; sketch: SketchData; dimension: SketchDimensionData } | { kind: "mate"; mate: MateData } | { kind: "error"; message: string }) => void;
  /** Evaluate on the dev server instead of in a page worker: the socket path (e.g. `/__eval`). */
  remoteEval?: string;
  /**
   * Write sketch drag edits to the source. Default: the dev server's `/__edit` (when there is a
   * dev server socket). The playground edits its editor; VS Code applies a WorkspaceEdit.
   */
  onSketchEdit?: (changes: SketchChange[]) => Promise<SketchEditResult>;
  /** Max kernels evaluating parts in parallel (default cores − 1, ≤ 4; 1 = off). `?pool=n` in the URL overrides. */
  pool?: number;
  /** Expose `window.__tscadViewer` (tests). Default true. */
  debugGlobal?: boolean;
}

/** A bundling failure as the viewer shows it. */
export interface BundleError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  lineText?: string;
  lines?: [number, string][];
}

/** What the host did with a sketch drag: applied, or refused with a reason. */
export interface SketchEditResult {
  applied: number;
  refused: { reason: string; param?: { name: string; value: number } }[];
  error?: string;
}

/** Control of a mounted viewer. */
export interface ViewerApi {
  /** Evaluate a bundled model module (any importable URL; blob: works). `map` is its raw source map. */
  load(url: string, map?: object, opts?: { resetParams?: boolean; refit?: boolean }): void;
  /** Show build errors (the bundle could not be produced). Empty clears them. */
  setBundleErrors(errors: BundleError[]): void;
  setFile(name: string): void;
  toast(text: string, sticky?: boolean): () => void;
  /** Current param values (for share links). */
  values(): ParamValuesData;
  readonly viewport: Viewport;
}

export type { StageError, EvalData };

/** Mount the viewer app (top bar, 3D workspace, panels, eval worker) into `root`. */
export function mountViewer(root: HTMLElement, config: Partial<ViewerConfig> = {}): ViewerApi {
  const cfg: ViewerConfig = {
    wasmUrl: "/wasm/tscad_wasm_bg.wasm",
    glueUrl: "/wasm/tscad_wasm.js",
    workerUrl: "/__tscad/viewer/worker.js",
    ...config,
  };

  // ── UI features (src/viewer/ui/*): they reach the viewer state through `ctx` (read lazily).
  const ctx = {
    get applyAnchorButton() { return applyAnchorButton; },
    get applySketchVisibility() { return applySketchVisibility; },
    get assembly() { return assembly; },
    get cfg() { return cfg; },
    get checkState() { return checkState; },
    get checkSummary() { return checkSummary; },
    get checks() { return checks; },
    get checksPop() { return checksPop; },
    get diffBody() { return diffBody; },
    get diffCard() { return diffCard; },
    get diffState() { return diffState; },
    get diffView() { return diffView; },
    get errorBox() { return errorBox; },
    get exportBtn() { return exportBtn; },
    get exportMenu() { return exportMenu; },
    get gizmo() { return gizmo; },
    get helpBtn() { return helpBtn; },
    get helpPop() { return helpPop; },
    get inspectorBody() { return inspectorBody; },
    get inspectorCard() { return inspectorCard; },
    get left() { return left; },
    get params() { return params; },
    get partsList() { return partsList; },
    get pinBtn() { return pinBtn; },
    get plateBody() { return plateBody; },
    get plateCard() { return plateCard; },
    get plateState() { return plateState; },
    get plateView() { return plateView; },
    get request() { return request; },
    get right() { return right; },
    get row() { return row; },
    get sectionPop() { return sectionPop; },
    get send() { return send; },
    get showTip() { return showTip; },
    get sketches() { return sketches; },
    get sourceClick() { return sourceClick; },
    get state() { return state; },
    get statsBody() { return statsBody; },
    get statsSummary() { return statsSummary; },
    get tb() { return tb; },
    get toast() { return toast; },
    get updateInsets() { return updateInsets; },
    get viewport() { return viewport; },
    get worker() { return worker; },
  } as ViewerContext;
  const { applyAnchorButton, applySketchVisibility, buildSectionPopover, toggleAnchors, toggleEdges, toggleMeasure, toggleOrtho, toggleSection, toggleSketches, toggleWire, toggleXray } = installToolbar(ctx);
  const { buildHelp } = installHelp(ctx);
  const { drawGizmo } = installGizmo(ctx);
  const errorsUi = installErrors(ctx);
  const { renderError } = errorsUi;
  const inspectorUi = installInspector(ctx);
  const { select } = inspectorUi;
  const statsUi = installStats(ctx);
  const { renderStats, row } = statsUi;
  const partsUi = installParts(ctx);
  const { renderParts } = partsUi;
  const platePanelUi = installPlatePanel(ctx);
  const { runPlate, togglePlate } = platePanelUi;
  const diffPanelUi = installDiffPanel(ctx);
  const { renderDiff, toggleDiff, togglePin } = diffPanelUi;
  const sketchDragUi = installSketchDrag(ctx);
  const checksPanelUi = installChecksPanel(ctx);
  const { buildChecksPopover, runChecks } = checksPanelUi;
  const exportMenuUi = installExportMenu(ctx);
  const { buildExportMenu } = exportMenuUi;

  // ───────────────────────── state ─────────────────────────

  const state: ViewerState = {
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
    buildAt: 0,
    editToRender: 0,
  };

  // ───────────────────────── layout ─────────────────────────

  const app = root;
  app.classList.add("tscad-app");
  const stage = h("div", { class: "stage" });
  const viewport = new Viewport(stage);
  const sketches = new SketchOverlay(viewport);
  const diffView = new DiffOverlay(viewport);
  const plateView = new PlateOverlay(viewport);
  const plateState = {
    on: false,
    bed: (() => {
      try {
        const v = JSON.parse(localStorage.getItem("tscad.bed") ?? "null");
        return Array.isArray(v) && v.length === 2 ? (v as [number, number]) : ([256, 256] as [number, number]);
      } catch {
        return [256, 256] as [number, number];
      }
    })(),
    spacing: 5,
    orient: "auto" as "auto" | "keep",
    data: undefined as PlateData | undefined,
    busy: false,
    again: false,
    error: "",
  };
  const diffState = { on: false, pinned: false, data: undefined as DiffData | undefined };
  const assembly = new AssemblyOverlay(viewport);
  assembly.setShowAnchors(localStorage.getItem("tscad.anchors") !== "0");
  assembly.onDrag = (u) => {
    params.setValue(u.param, u.value, false);
    showTip(`${u.field === "angle" ? `${+u.shown.toFixed(1)}°` : `${+u.shown.toFixed(2)} mm`} · ${u.param} = ${fmtNum(Number(params.values[u.param]))}`);
  };
  assembly.onDragEnd = () => {
    viewport.controls.enabled = true;
    hoverTip.classList.add("hidden");
  };
  /** The user's choice for the sketch overlay (undefined: on when the model has sketches). */
  sketches.onPatternClick = (sk, pat) => {
    const loc = pat.loc ?? sk.loc;
    if (loc) sourceClick(loc, { kind: "sketch", sketch: sk });
  };
  sketches.onDimensionClick = (sk, dim) => {
    if (dim.loc) sourceClick(dim.loc, { kind: "dimension", sketch: sk, dimension: dim });
    else toast(`${dim.text} (${dim.kind}) — no source location`);
  };

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
    ...(cfg.topbarExtras ?? []),
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
  const statsSummary = h("span", { class: "card-summary" });
  const statsCard = card("Model", "info", statsBody, [statsSummary]);
  statsCard.classList.add("stats-card");
  statsCard.querySelector(".card-head")!.addEventListener("click", () => {
    statsCard.classList.toggle("expanded");
    queueMicrotask(updateInsets);
  });
  const diffBody = h("div", { class: "diff" });
  const pinBtn = h("button", { class: "icon-btn sm", title: "Pin this version as the baseline (A/B compare)", onclick: () => togglePin() }, icon("pin", 14));
  const diffCard = card("Diff", "diff", diffBody, [pinBtn, h("button", { class: "icon-btn sm", title: "Close (D)", onclick: () => toggleDiff() }, icon("x", 14))]);
  diffCard.classList.add("hidden");
  const plateBody = h("div", { class: "plate" });
  const plateCard = card("Plate", "plate", plateBody, [h("button", { class: "icon-btn sm", title: "Close (P)", onclick: () => togglePlate() }, icon("x", 14))]);
  plateCard.classList.add("hidden");
  const right = h("aside", { class: "side right" }, inspectorCard, diffCard, plateCard, statsCard);

  /** Tell the viewport which screen edges the floating panels cover, so models centre in the gap. */
  function updateInsets() {
    const sr = stage.getBoundingClientRect();
    const shown = (el: HTMLElement) => el.offsetParent !== null && getComputedStyle(el).opacity !== "0";
    const lr = left.getBoundingClientRect(), rr = right.getBoundingClientRect();
    const leftIn = shown(left) ? Math.max(0, lr.right - sr.left) : 0;
    // A short right column (a folded card) leaves the view free below it: don't count it.
    const rightH = [...right.children].reduce((h, c) => h + (c.classList.contains("hidden") ? 0 : (c as HTMLElement).offsetHeight), 0);
    const rightCards = rightH > sr.height * 0.35;
    const rightIn = shown(right) && rightCards ? Math.max(0, sr.right - rr.left) : 0;
    viewport.setInsets(leftIn, rightIn);
  }

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
    sketch: tool("sketch", "Sketch overlay (K)", () => toggleSketches()),
    anchors: tool("anchor", "Anchors & joints (A)", () => toggleAnchors()),
    plate: tool("plate", "Plate: print orientation and bed layout (P)", () => togglePlate()),
    diff: tool("diff", "Diff: what the last change added / removed (D)", () => toggleDiff()),
    checks: tool("shield", "Checks: overhangs, thin walls, interference (C)", () => checksPop.classList.toggle("hidden")),
  };
  tb.edges.classList.add("active");
  const sectionPop = buildSectionPopover();
  const checks = new CheckOverlay(viewport);
  const checkState = { mode: "none" as CheckMode, maxOverhang: 45, minWall: 0.8, busy: false, again: false };
  const checkSummary = h("div", { class: "check-summary muted" }, "Pick a check to colour the model.");
  const checksPop = buildChecksPopover();
  const toolbar = h(
    "div",
    { class: "toolbar" },
    h("div", { class: "tool-group" }, tb.iso, tb.top, tb.front, tb.right),
    h("div", { class: "tool-sep" }),
    h("div", { class: "tool-group" }, tb.fit, tb.ortho),
    h("div", { class: "tool-sep" }),
    h("div", { class: "tool-group" }, tb.edges, tb.wire, tb.xray, tb.section, tb.measure, tb.sketch, tb.anchors, tb.diff, tb.plate, tb.checks),
  );
  const exportMenu = buildExportMenu();
  const helpPop = buildHelp();

  stage.append(gizmo, hoverTip);
  new ResizeObserver(() => updateInsets()).observe(stage);
  const workspace = h("main", { class: "workspace" }, stage, left, right, h("div", { class: "bottom" }, checksPop, sectionPop, errorBox, toolbar), toasts, exportMenu, helpPop);
  app.append(topbar, cfg.sidePane ? h("div", { class: "body-row" }, cfg.sidePane, workspace) : workspace, loader);

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

  // Server-side evaluation (dev server with the native kernel) or the wasm worker in this page.
  const worker: Pick<Worker, "postMessage"> & { onmessage: ((e: MessageEvent<FromWorker>) => void) | null; onerror: ((e: ErrorEvent) => void) | null } = cfg.remoteEval
    ? new RemoteWorker(cfg.remoteEval)
    : new Worker(cfg.workerUrl, { type: "module" });
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
        state.kernelVersion = m.version + (m.native ? " · native (server)" : "");
        loader.querySelector(".loader-text")!.textContent = "Evaluating model…";
        console.info(`[tscad] kernel ${m.version} ready in ${m.loadMs.toFixed(0)} ms`);
        if (state.bundleUrl) loadBundle(state.bundleUrl, bundleMap);
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
      case "diff":
        if (diffState.on && m.data.seq === state.data?.seq) {
          diffState.data = m.data;
          diffView.show(m.data);
          renderDiff();
        }
        break;
      case "pick":
      case "export":
      case "check":
      case "sketch-drag":
      case "plate":
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

  let bundleMap: object | undefined;

  /** Param values that differ from the schema's defaults (set by the user, the URL or a drag). */
  function userValues(): ParamValuesData {
    const out: ParamValuesData = {};
    for (const [k, v] of Object.entries(state.values)) {
      const spec = state.schema[k];
      if (!spec || v !== spec.default) out[k] = v;
    }
    return out;
  }
  let refitNext = false;
  function loadBundle(url: string, map?: object) {
    state.bundleUrl = url;
    bundleMap = map;
    if (!state.kernelReady) return;
    inFlight = true;
    queuedValues = undefined;
    // Only what the user changed: a default edited in the code must win over the old value.
    send({ type: "load", url, values: userValues(), map: bundleMap });
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

  const poolParam = new URLSearchParams(location.search).get("pool");
  send({ type: "init", wasmUrl: cfg.wasmUrl, glueUrl: cfg.glueUrl, pool: poolParam ? Number(poolParam) : cfg.pool });

  // ───────────────────────── results ─────────────────────────

  function onResult(data: EvalData) {
    // Edit → render latency: from the dev server noticing the edit to this result.
    if (state.buildAt) {
      state.editToRender = performance.now() - state.buildAt;
      state.buildAt = 0;
    }
    const first = !state.data;
    state.data = data;
    state.busy = "";
    state.schema = data.schema;
    state.values = { ...data.values };
    const failed = data.parts.filter((p) => !p.ok);
    state.error = failed.length ? kernelError(failed[0]!) : undefined;
    params.update(data.schema, data.values);
    viewport.setDrawings(data.drawings ?? []);
    sketches.set(data.sketches ?? []);
    applySketchVisibility();
    viewport.setParts(
      data.parts.map((p, i) => ({ name: p.name, color: state.colors[p.name] ?? p.color ?? PALETTE[i % PALETTE.length], mesh: p.mesh, failed: !p.ok })),
    );
    if (checkState.mode !== "none") queueMicrotask(runChecks);
    if (diffState.on) {
      diffView.clear(false);
      renderDiff();
    }
    if (plateState.on) queueMicrotask(() => void runPlate());
    assembly.values = data.values;
    assembly.set(data.assembly);
    assembly.refresh();
    applyAnchorButton();
    renderParts();
    renderStats();
    renderError();
    renderStatus();
    hideLoader();
    if (first || refitNext) {
      refitNext = false;
      updateInsets();
      viewport.setView("iso", false);
    }
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

  // ───────────────────────── params ─────────────────────────

  let hashTimer = 0;
  params.onChange = (values) => {
    state.values = values;
    runParams(values);
    clearTimeout(hashTimer);
    hashTimer = window.setTimeout(() => {
      const hash = withKept(valuesToHash(state.schema, values));
      history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
    }, 150);
  };

  window.addEventListener("hashchange", () => {
    const v = { ...state.values, ...hashToValues(location.hash, state.schema) };
    params.update(state.schema, v);
    state.values = v;
    runParams(v);
  });

  /** Params hash plus the keys the host keeps (e.g. the playground's `code`). */
  function withKept(paramsHash: string): string {
    const keep = cfg.hashKeep ?? [];
    if (!keep.length) return paramsHash;
    const cur = new URLSearchParams(location.hash.slice(1));
    const out = new URLSearchParams();
    for (const k of keep) if (cur.has(k)) out.set(k, cur.get(k)!);
    for (const [k, v] of new URLSearchParams(paramsHash)) out.set(k, v);
    return out.toString();
  }

  async function copyLink() {
    const hash = withKept(valuesToHash(state.schema, state.values));
    const url = `${location.origin}${location.pathname}${hash ? `#${hash}` : ""}`;
    if (await copyText(url)) toast("Link copied — it reproduces these parameters");
  }

  // ───────────────────────── pointer ─────────────────────────

  const pointerUi = installPointer(ctx, { stage, hoverTip, select, runParams, drag: sketchDragUi });

  // ───────────────────────── toolbar actions ─────────────────────────

  function showTip(text: string) {
    pointerUi.showTip(text);
  }

  function sourceClick(loc: Loc, target: Parameters<NonNullable<ViewerConfig["onSourceClick"]>>[1]) {
    if (cfg.onSourceClick) return cfg.onSourceClick(loc, target);
    const where = `${shortFile(loc.file)}:${loc.line}:${loc.column}`;
    void copyText(where);
    toast(`${target.kind === "dimension" ? `${target.dimension.text} — ` : ""}${where} (copied)`);
  }

  // ───────────────────────── export ─────────────────────────

  shotBtn.onclick = () => {
    const a = h("a", { href: viewport.screenshot(), download: `${state.file.replace(/^.*\//, "").replace(/\.[jt]sx?$/, "")}.png` });
    a.click();
  };

  // ───────────────────────── help / keys ─────────────────────────

  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest?.(".cm-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
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
      case "k":
        return toggleSketches();
      case "d":
        return toggleDiff();
      case "p":
        return togglePlate();
      case "a":
        return toggleAnchors();
      case "c":
        return checksPop.classList.toggle("hidden");
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
        state.buildAt = performance.now();
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
  if (cfg.debugGlobal !== false) (window as any).__tscadViewer = { state, viewport, select, request, assembly, params };

  return {
    load(url: string, map?: object, opts?: { resetParams?: boolean; refit?: boolean }) {
      if (opts?.resetParams) state.values = {};
      if (opts?.refit) refitNext = true;
      loadBundle(url, map);
    },
    setBundleErrors(errors: BundleError[]) {
      state.bundleErrors = errors;
      if (errors.length) {
        state.busy = "";
        hideLoader();
      }
      renderError();
      renderStatus();
    },
    setFile(name: string) {
      state.file = name;
      fileLabel.querySelector("span")!.textContent = name;
    },
    toast,
    values: () => ({ ...state.values }),
    viewport,
  };

}
