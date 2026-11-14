/** Viewer UI: pointer input on the viewport — hover tips, picking, measuring, and sketch / mate drags. */
import type { ParamValuesData } from "../protocol";
import type { Hit } from "../scene";
import { fmtNum } from "../fmt";
import type { ViewerContext } from "./context";
import type { installSketchDrag } from "./sketch-drag";

/** What the pointer handlers need from the viewer besides `ctx`. */
export interface PointerDeps {
  stage: HTMLElement;
  hoverTip: HTMLElement;
  select(hit: Hit | undefined): void;
  runParams(values: ParamValuesData): void;
  drag: ReturnType<typeof installSketchDrag>;
}

/** Installs the viewport's pointer handlers; returns `showTip` (a tip at the last pointer position). */
export function installPointer(ctx: ViewerContext, deps: PointerDeps) {
  const { assembly, params, plateState, sketches, state, toast, viewport } = ctx;
  const { stage, hoverTip, select, runParams, drag } = deps;
  const { finishDrag, solveDrag } = drag;

  let hoverFrame = 0;
  let lastMove: PointerEvent | undefined;
  let downAt: { x: number; y: number; t: number } | undefined;

  viewport.canvas.addEventListener("pointermove", (e) => {
    lastMove = e;
    if (e.buttons) {
      hoverTip.classList.add("hidden");
      return;
    }
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const ev = lastMove!;
      if (plateState.on) {
        viewport.setHover(undefined);
        hoverTip.classList.add("hidden");
        viewport.canvas.style.cursor = "";
        return;
      }
      const sp = !state.measure ? sketches.pickPoint(ev.clientX, ev.clientY) : undefined;
      if (sp) {
        viewport.setHover(undefined);
        viewport.canvas.style.cursor = "move";
        return showTip(`point ${sp.id}${sp.free ? "" : " (fixed)"} — drag to move · Shift: change dimensions`);
      }
      const giz = !state.measure ? assembly.hover(ev.clientX, ev.clientY) : undefined;
      if (giz) {
        viewport.setHover(undefined);
        viewport.canvas.style.cursor = giz.drive ? "grab" : "help";
        return showTip(assembly.describe(giz));
      }
      const hit = viewport.hitTest(ev.clientX, ev.clientY);
      viewport.setHover(hit);
      viewport.canvas.style.cursor = hit ? (state.measure ? "crosshair" : "pointer") : state.measure ? "crosshair" : "";
      if (hit) {
        const r = stage.getBoundingClientRect();
        hoverTip.classList.remove("hidden");
        hoverTip.textContent = state.measure ? `${fmtNum(hit.point.x)}, ${fmtNum(hit.point.y)}, ${fmtNum(hit.point.z)}` : `${hit.kind} ${hit.index} · ${hit.part}`;
        hoverTip.style.transform = `translate(${ev.clientX - r.left + 14}px, ${ev.clientY - r.top + 16}px)`;
      } else hoverTip.classList.add("hidden");
    });
  });
  viewport.canvas.addEventListener("pointerleave", () => {
    viewport.setHover(undefined);
    hoverTip.classList.add("hidden");
  });
  viewport.canvas.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
  // Joint gizmos get the pointer before the orbit controls (capture phase on the stage).
  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || state.measure || e.target !== viewport.canvas) return;
      const sp = sketches.pickPoint(e.clientX, e.clientY);
      if (sp) {
        e.stopPropagation();
        downAt = undefined;
        drag.sketchDrag = { ...sp, target: undefined, inflight: false, queued: false, result: undefined, shift: e.shiftKey };
        viewport.controls.enabled = false;
        try {
          viewport.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic */
        }
        return;
      }
      const g = assembly.beginDrag(e.clientX, e.clientY);
      if (g === false) return;
      e.stopPropagation();
      downAt = undefined;
      if (!g?.drive) {
        if (g) toast(`${assembly.describe(g)} — bind its ${g.field} to a param to drag it`);
        return;
      }
      viewport.controls.enabled = false;
      try {
        viewport.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      viewport.canvas.style.cursor = "grabbing";
    },
    { capture: true },
  );
  stage.addEventListener(
    "pointermove",
    (e) => {
      if (drag.sketchDrag) {
        lastMove = e;
        e.stopPropagation();
        drag.sketchDrag.shift = e.shiftKey;
        const t = sketches.toSketch(drag.sketchDrag.sketch, e.clientX, e.clientY);
        if (t) {
          drag.sketchDrag.target = t;
          void solveDrag();
        }
        return;
      }
      if (!assembly.dragging) return;
      lastMove = e;
      e.stopPropagation();
      assembly.drag(e.clientX, e.clientY);
    },
    { capture: true },
  );
  stage.addEventListener(
    "pointerup",
    (e) => {
      if (drag.sketchDrag) {
        e.stopPropagation();
        const d = drag.sketchDrag;
        drag.sketchDrag = undefined;
        viewport.controls.enabled = true;
        hoverTip.classList.add("hidden");
        void finishDrag(d);
        return;
      }
      if (!assembly.dragging) return;
      e.stopPropagation();
      assembly.endDrag();
      runParams({ ...params.values });
    },
    { capture: true },
  );
  viewport.canvas.addEventListener("pointerup", (e) => {
    if (!downAt || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = undefined;
    if (moved > 4) return;
    if (state.measure) {
      const p = viewport.measurePoint(e.clientX, e.clientY);
      if (!p) return;
      const res = viewport.addMeasurePoint(p);
      if (res) toast(`Distance ${fmtNum(res.a.distanceTo(res.b), 3)} mm`);
      return;
    }
    if (plateState.on) return;
    select(viewport.hitTest(e.clientX, e.clientY));
  });
  viewport.canvas.addEventListener("dblclick", (e) => {
    if (!viewport.hitTest(e.clientX, e.clientY)) viewport.fit();
  });

  function showTip(text: string) {
    if (!lastMove) return;
    const r = stage.getBoundingClientRect();
    hoverTip.classList.remove("hidden");
    hoverTip.textContent = text;
    hoverTip.style.transform = `translate(${lastMove.clientX - r.left + 14}px, ${lastMove.clientY - r.top + 16}px)`;
  }

  return { showTip };
}
