/** Viewer UI: help (shares the viewer's state through `ctx`). */
import { h } from "../dom";
import type { ViewerContext } from "./context";

/** Installs the help feature; returns its functions for the viewer to call. */
export function installHelp(ctx: ViewerContext) {
  function buildHelp() {
    const { exportMenu, helpBtn } = ctx;
    const keys: [string, string][] = [
      ["F", "Fit to view"],
      ["1 2 3 4", "Iso · Top · Front · Right"],
      ["O", "Orthographic / perspective"],
      ["E", "Toggle edges"],
      ["W", "Toggle wireframe"],
      ["T", "X-ray"],
      ["X", "Section plane"],
      ["M", "Measure"],
      ["K", "Sketch overlay"],
      ["D", "Diff with the previous / pinned version"],
      ["P", "Plate: print orientation and bed layout"],
      ["A", "Anchors & joints (drag a joint to drive it)"],
      ["C", "Checks: overhang, thin walls, interference"],
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
    helpBtn.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      pop.classList.toggle("hidden");
      exportMenu.classList.add("hidden");
    });
    document.addEventListener("click", (e: Event) => {
      if (!pop.contains(e.target as Node)) pop.classList.add("hidden");
    });
    return pop;
  }
  return { buildHelp };
}
