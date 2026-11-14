/** Viewer UI: help (shares the viewer's state through `ctx`). */
import { h } from "../dom";
import { MOUSE_SCHEMES, mouseHelp, saveMouseScheme } from "../controls";
import type { ViewerContext } from "./context";

/** Installs the help feature; returns its functions for the viewer to call. */
export function installHelp(ctx: ViewerContext) {
  function buildHelp() {
    const { exportMenu, helpBtn, viewport } = ctx;
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
      ["Drag", "Move a sketch point or a joint gizmo"],
      ["Double-click", "Fit (on empty space)"],
      ["Esc", "Clear selection / measure"],
      ["?", "This help"],
    ];
    // Mouse scheme: CAD (right orbits, middle pans) or classic (left orbits, right pans), remembered.
    const foot = h("div", { class: "menu-foot muted" }, mouseHelp(viewport.mouseScheme));
    const mouseSeg = h(
      "div",
      { class: "segmented sm" },
      ...MOUSE_SCHEMES.map((m) =>
        h(
          "button",
          {
            class: m.id === viewport.mouseScheme ? "active" : "",
            title: m.hint,
            "data-mouse": m.id,
            onclick: (e: Event) => {
              e.stopPropagation();
              viewport.setMouseScheme(m.id);
              saveMouseScheme(m.id);
              for (const b of mouseSeg.children) b.classList.toggle("active", b.getAttribute("data-mouse") === m.id);
              foot.textContent = mouseHelp(m.id);
            },
          },
          m.label,
        ),
      ),
    );
    const pop = h(
      "div",
      { class: "menu help-pop hidden" },
      h("div", { class: "menu-title" }, "Keyboard shortcuts"),
      ...keys.map(([k, d]) => h("div", { class: "help-row" }, h("span", null, d), h("span", { class: "keys" }, ...k.split(" ").map((x) => h("kbd", null, x))))),
      h("div", { class: "help-row help-mouse" }, h("span", null, "Mouse"), mouseSeg),
      foot,
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
