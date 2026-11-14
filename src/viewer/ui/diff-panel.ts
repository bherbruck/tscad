/** Viewer UI: diff-panel (split out of app.ts; shares the viewer's state through `ctx`). */
import { h, icon } from "../dom";
import { fmtMs, fmtVol } from "./format";
import type { ParamValuesData } from "../protocol";
import { fmtNum } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the diff-panel feature; returns its functions for the viewer to call. */
export function installDiffPanel(ctx: ViewerContext) {
  function toggleDiff() {
    const { diffCard, diffState, diffView, send, tb, updateInsets } = ctx;
    diffState.on = !diffState.on;
    send({ type: "diff", on: diffState.on });
    tb.diff.classList.toggle("active", diffState.on);
    diffCard.classList.toggle("hidden", !diffState.on);
    if (!diffState.on) {
      diffView.clear();
      diffState.data = undefined;
      if (diffState.pinned) togglePin();
    } else renderDiff();
    queueMicrotask(updateInsets);
  }
  function togglePin() {
    const { diffState, pinBtn, send, toast } = ctx;
    diffState.pinned = !diffState.pinned;
    send({ type: "diff-pin", pin: diffState.pinned });
    pinBtn.classList.toggle("active", diffState.pinned);
    toast(diffState.pinned ? "Pinned: later changes are compared with this version" : "Comparing with the previous version");
  }
  function renderDiff() {
    const { diffBody, diffState, state } = ctx;
    diffBody.replaceChildren();
    const d = diffState.data;
    if (!d || d.seq !== state.data?.seq) {
      diffBody.append(h("div", { class: "empty" }, diffState.pinned ? "Pinned. Change a param or the code to compare." : "Change a param or the code: what it adds shows green, what it removes red."));
      return;
    }
    if (d.baseline === "none") {
      diffBody.append(h("div", { class: "empty" }, "Change a param or the code to see what it adds (green) and removes (red)."));
      return;
    }
    const vs = d.baseline === "pinned" ? `vs pinned${d.baselineValues ? ` (${changedParams(d.baselineValues)})` : ""}` : "vs previous";
    diffBody.append(h("div", { class: "diff-head muted" }, `${vs} · ${fmtMs(d.millis)}`));
    const changed = d.parts.filter((p) => p.status !== "same");
    if (!changed.length) {
      diffBody.append(h("div", { class: "empty" }, "No geometry changed."));
      return;
    }
    for (const p of d.parts) {
      if (p.status === "same") continue;
      const size = p.deltaSize?.some((v) => Math.abs(v) > 1e-6) ? `Δ ${p.deltaSize.map((v) => (v > 0 ? "+" : "") + fmtNum(v)).join(" × ")} mm` : "";
      diffBody.append(
        h(
          "div",
          { class: "diff-row" },
          h("div", { class: "diff-name" }, p.part, p.status !== "changed" ? h("span", { class: `chip ${p.status}` }, p.status) : null),
          h(
            "div",
            { class: "diff-nums" },
            h("span", { class: "add" }, `+${fmtVol(p.addedVolume)}`),
            h("span", { class: "rem" }, `−${fmtVol(p.removedVolume)}`),
            h("span", { class: "net" }, `net ${p.deltaVolume >= 0 ? "+" : "−"}${fmtVol(Math.abs(p.deltaVolume))}`),
          ),
          size ? h("div", { class: "diff-size muted" }, size) : null,
          p.error ? h("div", { class: "warning" }, icon("alert", 12), p.error) : null,
        ),
      );
    }
  }
  /** "width 60, holes 3": the pinned values that differ from the current ones. */
  function changedParams(base: ParamValuesData): string {
    const { state } = ctx;
    const diffs = Object.entries(base).filter(([k, v]) => state.values[k] !== v).map(([k, v]) => `${k} ${String(v)}`);
    return diffs.length ? diffs.join(", ") : "same params";
  }
  return { changedParams, renderDiff, toggleDiff, togglePin, };
}
