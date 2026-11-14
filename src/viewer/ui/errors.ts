/** Viewer UI: errors (split out of app.ts; shares the viewer's state through `ctx`). */
import { h, icon } from "../dom";
import { shortFile, highlightTsx } from "./format";
import type { CodeFrame, Loc } from "../protocol";
import type { ViewerContext } from "./context";

/** Installs the errors feature; returns its functions for the viewer to call. */
export function installErrors(ctx: ViewerContext) {
  function renderError() {
    const { cfg, errorBox, state, viewport } = ctx;
    cfg.onErrors?.(state.error, state.bundleErrors, state.data);
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
    const { errorBox, sourceClick } = ctx;
    return h(
      "div",
      { class: "err-head" },
      icon("alert", 16),
      h("div", { class: "err-text" }, h("div", { class: "err-title" }, title, loc ? h("button", { class: "err-loc", title: "Show in the code", onclick: () => sourceClick(loc, { kind: "error", message }) }, `${shortFile(loc.file)}:${loc.line}:${loc.column}`) : null), h("div", { class: "err-msg" }, message)),
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
  return { errorHead, frameEl, renderError, };
}
