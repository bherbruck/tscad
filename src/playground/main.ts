/**
 * The static playground: a CodeMirror editor beside the tscad viewer. Edits are compiled in the
 * browser (sucrase), loaded as a blob module by the same eval worker the dev server uses, and
 * errors come back as squiggles. Everything is relative to the page, so it can live under any
 * path (GitHub Pages serves it from /<repo>/).
 */
import { mountViewer, type BundleError, type StageError } from "../viewer/app";
import { copyText, h, icon } from "../viewer/dom";
import { createEditor, type CompletionData, type EditorProblem } from "./editor";
import { decodeSource, encodeSource } from "./share";
import { transformModel } from "./transform";

interface Example {
  name: string;
  title: string;
  description: string;
  source: string;
}

const FILE = "model.tsx";

/** The props a sketch dimension may come from, by kind (for selecting it in the code). */
const DIMENSION_PROPS: Record<string, string[]> = {
  length: ["length"],
  radius: ["radius", "r"],
  diameter: ["diameter", "d"],
  angle: ["angle", "value"],
  sweep: ["angle"],
  distance: ["distance", "value"],
  dx: ["dx"],
  dy: ["dy"],
};
const DRAFT_KEY = "tscad.playground.draft";
const abs = (p: string) => new URL(p, document.baseURI).href;

/** Bundled library entries (same files the worker imports, so one runtime instance). */
const RUNTIME: Record<string, string> = {
  tscad: abs("__tscad/index.js"),
  "tscad/jsx-runtime": abs("__tscad/jsx-runtime.js"),
  "tscad/jsx-dev-runtime": abs("__tscad/jsx-dev-runtime.js"),
  "tscad/parts": abs("__tscad/parts/index.js"),
};

const STARTER = `import { defineParams, edges, type ParamValues } from "tscad"

export const params = defineParams({
  size: { type: "number", default: 30, min: 10, max: 80, unit: "mm" },
  round: { type: "number", default: 3, min: 0, max: 8, step: 0.5, unit: "mm" },
})

export default function Model(p: ParamValues<typeof params>) {
  return (
    <part name="cube" material="petg">
      <fillet radius={p.round} edges={edges.top()}>
        <box size={p.size} />
      </fillet>
    </part>
  )
}
`;

async function main() {
  const [examples, completions] = await Promise.all([
    fetch(abs("examples.json")).then((r) => (r.ok ? (r.json() as Promise<Example[]>) : [])).catch(() => [] as Example[]),
    fetch(abs("completions.json")).then((r) => (r.ok ? (r.json() as Promise<CompletionData>) : undefined)).catch(() => undefined),
  ]);

  // Which source to start with: a shared link, an example link, the last draft, or the default example.
  const hash = new URLSearchParams(location.hash.slice(1));
  let source = STARTER;
  let current = "";
  const shared = hash.get("code");
  const exampleName = hash.get("example");
  if (shared) {
    try {
      source = decodeSource(shared);
    } catch {
      /* corrupt link: fall through */
    }
  } else if (exampleName && examples.some((e) => e.name === exampleName)) {
    current = exampleName;
    source = examples.find((e) => e.name === exampleName)!.source;
  } else {
    const draft = safeGet(DRAFT_KEY);
    const first = examples.find((e) => e.name === "bracket") ?? examples[0];
    if (draft) source = draft;
    else if (first) {
      current = first.name;
      source = first.source;
    }
  }

  // ── editor pane
  const editorHost = h("div", { class: "pg-editor" });
  const runState = h("span", { class: "pg-run-state" });
  const editorHead = h(
    "div",
    { class: "pg-editor-head" },
    h("span", { class: "pg-tab" }, icon("file", 13), FILE),
    h("span", { class: "spacer" }),
    runState,
    h("span", { class: "pg-hint" }, h("kbd", null, isMac() ? "⌘" : "Ctrl"), h("kbd", null, "S"), " run"),
  );
  const resizer = h("div", { class: "pg-resizer", title: "Drag to resize" });
  const pane = h("section", { class: "pg-pane" }, editorHead, editorHost, resizer);
  const savedWidth = Number(safeGet("tscad.playground.width"));
  if (savedWidth > 200) pane.style.width = `${savedWidth}px`;

  // ── top bar extras
  const select = h(
    "select",
    { class: "pg-examples", title: "Examples" },
    h("option", { value: "" }, "Examples…"),
    ...examples.map((e) => h("option", { value: e.name, selected: e.name === current }, e.title)),
  ) as HTMLSelectElement;
  const exampleWrap = h("label", { class: "pg-select" }, icon("layers", 14), select, icon("chevron", 13));
  const shareBtn = h("button", { class: "btn", title: "Copy a link with this code and these parameters" }, icon("link", 14), h("span", null, "Share"));
  const codeBtn = h("button", { class: "icon-btn pg-code-toggle", title: "Show / hide code" }, icon("panel"));

  let problemsFromRun: EditorProblem[] = [];
  const viewer = mountViewer(document.getElementById("app")!, {
    wasmUrl: abs("wasm/tscad_wasm_bg.wasm"),
    glueUrl: abs("wasm/tscad_wasm.js"),
    workerUrl: abs("__tscad/viewer/worker.js"),
    file: FILE,
    topbarExtras: [h("div", { class: "pg-extras" }, exampleWrap, shareBtn, codeBtn)],
    sidePane: pane,
    hashKeep: ["code", "example"],
    onSourceClick: (loc, target) => {
      if (!sameFile(loc.file)) return void viewer.toast(`${loc.file}:${loc.line}`);
      document.body.classList.remove("pg-code-hidden");
      const props = target.kind === "dimension" ? DIMENSION_PROPS[target.dimension.kind] : undefined;
      editor?.revealSource(loc.line, loc.column, props);
      if (target.kind === "dimension") viewer.toast(`${target.dimension.text} — line ${loc.line}`);
    },
    onErrors: (err, bundleErrors) => {
      const problems: EditorProblem[] = [];
      for (const b of bundleErrors) if (b.line) problems.push({ line: b.line, column: b.column, message: b.message });
      if (!bundleErrors.length && err?.loc && sameFile(err.loc.file)) problems.push({ line: err.loc.line, column: err.loc.column, message: errText(err) });
      problemsFromRun = problems;
      editor?.setProblems(problems);
    },
  });

  // ── compile + run
  let lastUrl = "";
  let timer = 0;
  let editor: ReturnType<typeof createEditor> | undefined;
  let resetParams = false;
  const run = () => {
    clearTimeout(timer);
    const text = editor?.getValue() ?? source;
    safeSet(DRAFT_KEY, text);
    const t = performance.now();
    try {
      const out = transformModel(text, FILE, (spec) => RUNTIME[spec]);
      const url = URL.createObjectURL(new Blob([out.code], { type: "text/javascript" }));
      const prev = lastUrl;
      lastUrl = url;
      // The worker has imported the old module long before this fires.
      if (prev) setTimeout(() => URL.revokeObjectURL(prev), 30_000);
      viewer.setBundleErrors([]);
      viewer.load(url, out.map, { resetParams, refit: resetParams });
      resetParams = false;
      runState.textContent = `compiled in ${(performance.now() - t).toFixed(1)} ms`;
    } catch (e: any) {
      const err: BundleError = { message: String(e?.message ?? e), file: FILE, line: e?.line, column: e?.column };
      if (err.line) err.lines = frame(text, err.line);
      viewer.setBundleErrors([err]);
      runState.textContent = "syntax error";
    }
  };
  editor = createEditor(editorHost, {
    doc: source,
    completions,
    onChange: () => {
      clearTimeout(timer);
      timer = window.setTimeout(run, 350);
      // Squiggles from the last run may be stale now; keep them until the next result.
      void problemsFromRun;
    },
    onRun: run,
  });
  run();

  // ── examples
  select.addEventListener("change", () => {
    const ex = examples.find((e) => e.name === select.value);
    if (!ex) return;
    resetParams = true;
    editor!.setValue(ex.source);
    // A fresh model: drop the old params and code from the hash.
    history.replaceState(null, "", `#example=${encodeURIComponent(ex.name)}`);
    run();
    viewer.toast(`${ex.title}${ex.description ? ` — ${ex.description}` : ""}`);
  });

  // ── share
  shareBtn.addEventListener("click", async () => {
    const q = new URLSearchParams(location.hash.slice(1));
    q.delete("example");
    q.set("code", encodeSource(editor!.getValue()));
    const url = `${location.origin}${location.pathname}#${q.toString()}`;
    history.replaceState(null, "", `#${q.toString()}`);
    if (await copyText(url)) viewer.toast(`Link copied (${(url.length / 1024).toFixed(1)} kB) — opens this code with these parameters`);
  });

  // ── layout: code toggle + resizer
  codeBtn.addEventListener("click", () => document.body.classList.toggle("pg-code-hidden"));
  if (window.matchMedia("(max-width: 820px)").matches) document.body.classList.add("pg-code-hidden");
  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const startX = e.clientX, startW = pane.getBoundingClientRect().width;
    document.body.classList.add("pg-resizing");
    const move = (ev: PointerEvent) => {
      const w = Math.max(260, Math.min(window.innerWidth - 360, startW + ev.clientX - startX));
      pane.style.width = `${w}px`;
    };
    const up = () => {
      resizer.removeEventListener("pointermove", move);
      document.body.classList.remove("pg-resizing");
      safeSet("tscad.playground.width", String(Math.round(pane.getBoundingClientRect().width)));
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up, { once: true });
  });

  (window as any).__tscadPlayground = { editor, run, examples, viewer };
}

function sameFile(f: string) {
  return f === FILE || f.endsWith(`/${FILE}`) || f.startsWith("blob:");
}

function errText(e: StageError) {
  return e.message;
}

function frame(text: string, line: number): [number, string][] {
  const all = text.split("\n");
  const out: [number, string][] = [];
  for (let n = Math.max(1, line - 3); n <= Math.min(all.length, line + 2); n++) out.push([n, all[n - 1] ?? ""]);
  return out;
}

function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

main();
