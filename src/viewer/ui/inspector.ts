/** Viewer UI: inspector (split out of app.ts; shares the viewer's state through `ctx`). */
import { copyText, h, icon } from "../dom";
import { highlightTsx } from "./format";
import type { PickInfo } from "../../ir";
import type { Hit } from "../scene";
import { describe, selectorAttr } from "../selectors";
import { fmtNum } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the inspector feature; returns its functions for the viewer to call. */
export function installInspector(ctx: ViewerContext) {
  async function select(hit: Hit | undefined) {
    const { request, state, viewport } = ctx;
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
    const { inspectorBody, inspectorCard, row, state, toast, updateInsets } = ctx;
    const s = state.selection;
    inspectorCard.classList.toggle("hidden", !s);
    queueMicrotask(updateInsets);
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
    if ((info as { smooth?: boolean }).smooth) {
      inspectorBody.append(h("div", { class: "note" }, icon("info", 12), h("span", null, h("b", null, "Smooth edge"), " — a tangent joint between faces, nothing to fillet. Broad selectors skip these; only its index names it.")));
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
    // A smooth edge has nothing to fillet: no fillet snippet for it.
    if (best && !(info as { smooth?: boolean }).smooth) {
      const op = hit.kind === "edge" ? `<fillet radius={1} ${selectorAttr(best.selector, noun, state.form)}>` : `<shell thickness={2} ${selectorAttr(best.selector, noun, state.form)}>`;
      inspectorBody.append(h("div", { class: "snippet" }, h("code", { html: highlightTsx(op) }), h("button", { class: "icon-btn sm", title: "Copy snippet", onclick: async () => (await copyText(op)) && toast("Snippet copied") }, icon("copy", 13))));
    }
  }
  return { renderInspector, select, };
}
