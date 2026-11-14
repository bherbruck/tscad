/** Viewer UI: gizmo (shares the viewer's state through `ctx`). */
import type { ViewName } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the gizmo feature; returns its functions for the viewer to call. */
export function installGizmo(ctx: ViewerContext) {
  function drawGizmo() {
    const { gizmo, viewport } = ctx;
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
  return { drawGizmo };
}
