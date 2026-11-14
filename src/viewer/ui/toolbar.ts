/** Viewer UI: toolbar (shares the viewer's state through `ctx`). */
import { h, icon } from "../dom";
import type { SectionAxis } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the toolbar feature; returns its functions for the viewer to call. */
export function installToolbar(ctx: ViewerContext) {
  /** The user's choice for the sketch overlay (undefined: on when the model has sketches). */
  let sketchPref: boolean | undefined = (() => {
    const v = localStorage.getItem("tscad.sketches");
    return v === null ? undefined : v === "1";
  })();
  function toggleAnchors() {
    const { applyAnchorButton, assembly, toast } = ctx;
    if (!assembly.present) return void toast("This model has no anchors or mates");
    assembly.setShowAnchors(!assembly.showAnchors);
    try {
      localStorage.setItem("tscad.anchors", assembly.showAnchors ? "1" : "0");
    } catch {
      /* private mode */
    }
    applyAnchorButton();
  }
  function applyAnchorButton() {
    const { assembly, tb } = ctx;
    tb.anchors.classList.toggle("active", assembly.present && assembly.showAnchors);
    tb.anchors.classList.toggle("dim", !assembly.present);
  }
  function applySketchVisibility() {
    const { sketches, tb } = ctx;
    const has = sketches.count > 0;
    const on = has && (sketchPref ?? true);
    sketches.setVisible(on);
    tb.sketch.classList.toggle("active", on);
    tb.sketch.classList.toggle("dim", !has);
    tb.sketch.title = has ? "Sketch overlay (K)" : "Sketch overlay (K): this model has no constraint sketches";
  }
  function toggleSketches() {
    const { applySketchVisibility, sketches, toast } = ctx;
    if (!sketches.count) return void toast("This model has no constraint sketches");
    sketchPref = !sketches.visible;
    try {
      localStorage.setItem("tscad.sketches", sketchPref ? "1" : "0");
    } catch {
      /* private mode */
    }
    applySketchVisibility();
  }
  function toggleOrtho() {
    const { tb, toast, viewport } = ctx;
    viewport.setOrtho(!viewport.isOrtho);
    tb.ortho.classList.toggle("active", viewport.isOrtho);
    tb.ortho.replaceChildren(icon(viewport.isOrtho ? "square" : "square", 17));
    toast(viewport.isOrtho ? "Orthographic" : "Perspective");
  }
  function toggleEdges() {
    const { tb, viewport } = ctx;
    viewport.showEdges = !viewport.showEdges;
    tb.edges.classList.toggle("active", viewport.showEdges);
    viewport.restyle();
  }
  function toggleWire() {
    const { tb, viewport } = ctx;
    viewport.wireframe = !viewport.wireframe;
    tb.wire.classList.toggle("active", viewport.wireframe);
    viewport.restyle();
  }
  function toggleXray() {
    const { tb, viewport } = ctx;
    viewport.xray = !viewport.xray;
    tb.xray.classList.toggle("active", viewport.xray);
    viewport.restyle();
  }
  function toggleSection() {
    const { sectionPop, tb, viewport } = ctx;
    const on = !viewport.section.enabled;
    viewport.setSection({ enabled: on });
    tb.section.classList.toggle("active", on);
    sectionPop.classList.toggle("hidden", !on);
  }
  function toggleMeasure() {
    const { state, tb, toast, viewport } = ctx;
    state.measure = !state.measure;
    tb.measure.classList.toggle("active", state.measure);
    if (!state.measure) viewport.clearMeasure();
    else toast("Click two points to measure · Esc to clear");
  }
  function buildSectionPopover() {
    const { viewport } = ctx;
    const axes = (["x", "y", "z"] as SectionAxis[]).map((a) =>
      h("button", { class: a === "z" ? "active" : "", onclick: () => { viewport.setSection({ axis: a }); axes.forEach((b) => b.classList.toggle("active", b.textContent === a.toUpperCase())); } }, a.toUpperCase()),
    );
    const slider = h("input", { type: "range", min: 0, max: 1, step: 0.001, value: "0.5" }) as HTMLInputElement;
    const paint = () => slider.style.setProperty("--fill", `${Number(slider.value) * 100}%`);
    paint();
    slider.addEventListener("input", () => {
      paint();
      viewport.setSection({ offset: Number(slider.value) });
    });
    const flip = h("button", { class: "icon-btn sm", title: "Flip side", onclick: () => viewport.setSection({ flip: !viewport.section.flip }) }, icon("flip", 14));
    return h("div", { class: "section-pop hidden" }, icon("section", 15), h("div", { class: "segmented sm" }, ...axes), slider, flip);
  }
  return { applyAnchorButton, applySketchVisibility, buildSectionPopover, toggleAnchors, toggleEdges, toggleMeasure, toggleOrtho, toggleSection, toggleSketches, toggleWire, toggleXray };
}
