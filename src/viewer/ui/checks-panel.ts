/** Viewer UI: checks-panel (split out of app.ts; shares the viewer's state through `ctx`). */
import { h, icon } from "../dom";
import { fmtMs, fmtVol, fmtArea } from "./format";
import type { InterferenceData, PrintabilityData } from "../protocol";
import type { CheckMode } from "../check-overlay";
import { fmtNum } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the checks-panel feature; returns its functions for the viewer to call. */
export function installChecksPanel(ctx: ViewerContext) {
  function buildChecksPopover() {
    // This builds `checksPop` itself: read it from ctx when clicked.
    const { checkState, checkSummary, tb } = ctx;
    const modes: [CheckMode, string][] = [
      ["none", "Off"],
      ["overhang", "Overhang"],
      ["thin", "Thin walls"],
      ["interference", "Interference"],
    ];
    const seg = h("div", { class: "segmented sm" });
    const btns = modes.map(([m, label]) =>
      h("button", { class: m === "none" ? "active" : "", onclick: () => { checkState.mode = m; btns.forEach((b, i) => b.classList.toggle("active", modes[i]![0] === m)); tb.checks.classList.toggle("active", m !== "none"); runChecks(); } }, label),
    );
    seg.append(...btns);
    const num = (value: number, step: number, unit: string, set: (v: number) => void) => {
      const i = h("input", { type: "number", value: String(value), step: String(step), min: "0", class: "num" }) as HTMLInputElement;
      i.addEventListener("change", () => {
        const v = Number(i.value);
        if (v > 0) {
          set(v);
          runChecks();
        }
      });
      return h("div", { class: "num-wrap sm" }, i, h("span", { class: "unit" }, unit));
    };
    return h(
      "div",
      { class: "checks-pop hidden" },
      h("div", { class: "checks-row" }, icon("shield", 15), seg, h("span", { class: "spacer" }), h("button", { class: "icon-btn sm", title: "Close", onclick: () => ctx.checksPop.classList.add("hidden") }, icon("x", 14))),
      h(
        "div",
        { class: "checks-row opts" },
        h("label", null, "Max overhang", num(checkState.maxOverhang, 1, "°", (v) => (checkState.maxOverhang = v))),
        h("label", null, "Min wall", num(checkState.minWall, 0.1, "mm", (v) => (checkState.minWall = v))),
        h("div", { class: "legend" }, h("i"), h("span", null, "ok → past limit")),
      ),
      checkSummary,
    );
  }
  /** Run the active check (latest wins), then colour the model. */
  async function runChecks() {
    const { checkState, checkSummary, checks, request, state, viewport } = ctx;
    if (checkState.mode === "none") {
      checks.clear();
      checkSummary.textContent = "Pick a check to colour the model.";
      return;
    }
    if (checkState.busy) return void (checkState.again = true);
    const d = state.data;
    if (!d) return;
    checkState.busy = true;
    const mode = checkState.mode;
    checkSummary.textContent = "Checking…";
    try {
      const visible = d.parts.filter((p) => p.ok && !p.empty && (viewport.parts.get(p.name)?.visible ?? true));
      if (mode === "interference") {
        const r = await request<{ interference?: InterferenceData; error?: string }>({ type: "check", kind: "interference", parts: visible.map((p) => p.name) });
        if (r.error || !r.interference) throw new Error(r.error ?? "no result");
        if (checkState.mode !== mode) return;
        checks.showInterference(r.interference);
        const pr = r.interference.pairs;
        checkSummary.replaceChildren(
          pr.length
            ? h("span", { class: "bad" }, `${pr.length} interfering pair${pr.length > 1 ? "s" : ""}: ${pr.map((p) => `${p.a} ∩ ${p.b} ${fmtVol(p.volume)}`).join(" · ")}`)
            : h("span", { class: "good" }, `No interference (${r.interference.checked} pair${r.interference.checked === 1 ? "" : "s"} checked, ${fmtMs(r.interference.millis)})`),
        );
      } else {
        const parts = visible
          .map((p) => viewport.parts.get(p.name))
          .filter((v) => !!v)
          .map((v) => ({ name: v!.name, positions: v!.data.positions.slice(), indices: v!.data.indices.slice(), faceIds: v!.data.faceIds.slice() }));
        const r = await request<{ printability?: PrintabilityData[]; error?: string }>({ type: "check", kind: "printability", parts, maxOverhangDeg: checkState.maxOverhang, minWall: checkState.minWall, thickness: mode === "thin" });
        if (r.error || !r.printability) throw new Error(r.error ?? "no result");
        if (checkState.mode !== mode) return;
        checks.showPrintability(r.printability, mode, checkState.minWall);
        if (mode === "overhang") {
          const area = r.printability.reduce((s, x) => s + x.overhangArea, 0);
          checkSummary.replaceChildren(area > 0 ? h("span", { class: "warn" }, `Overhang past ${checkState.maxOverhang}°: ${fmtArea(area)} — needs support`) : h("span", { class: "good" }, `No overhangs past ${checkState.maxOverhang}° (build direction +Z)`));
        } else {
          const min = Math.min(...r.printability.map((x) => x.minWall ?? Infinity));
          const thin = r.printability.some((x) => (x.thinFraction ?? 0) > 0);
          checkSummary.replaceChildren(thin ? h("span", { class: "bad" }, `Thinnest wall ${fmtNum(min)} mm — under ${checkState.minWall} mm in red`) : h("span", { class: "good" }, `Thinnest wall ${isFinite(min) ? `${fmtNum(min)} mm` : "—"}: all ≥ ${checkState.minWall} mm`));
        }
      }
    } catch (e) {
      checkSummary.textContent = `Check failed: ${(e as Error).message}`;
    } finally {
      checkState.busy = false;
      if (checkState.again) {
        checkState.again = false;
        runChecks();
      }
    }
  }
  return { buildChecksPopover, runChecks, };
}
