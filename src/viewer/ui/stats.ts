/** Viewer UI: stats (split out of app.ts; shares the viewer's state through `ctx`). */
import { h, icon } from "../dom";
import { fmtMs, fmtVol, fmtMass } from "./format";
import { fmtNum } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the stats feature; returns its functions for the viewer to call. */
export function installStats(ctx: ViewerContext) {
  function renderStats() {
    const { state, statsBody, statsSummary, viewport } = ctx;
    const d = state.data;
    statsBody.replaceChildren();
    statsSummary.textContent = d ? `${fmtVol(d.parts.reduce((s, p) => s + (p.ok ? (p.volume ?? 0) : 0), 0))} · ${fmtMs(d.timings.total)}` : "";
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
      h(
        "div",
        { class: "stat-rows" },
        row("Triangles", tris.toLocaleString()),
        row("Kernel", state.kernelVersion ? `solidcore ${state.kernelVersion}${d.workers > 1 ? ` · ${d.workers}× parallel` : ""}` : "—"),
      ),
    );
    for (const w of d.warnings) statsBody.append(h("div", { class: "warning" }, icon("alert", 12), w));
  }
  function kpi(label: string, value: string, unit?: string) {
    return h("div", { class: "kpi" }, h("div", { class: "kpi-label" }, label), h("div", { class: "kpi-value" }, value, unit ? h("small", null, ` ${unit}`) : null));
  }
  function row(k: string, v: string | HTMLElement) {
    return h("div", { class: "stat-row" }, h("span", null, k), h("b", null, v));
  }
  return { kpi, renderStats, row, };
}
