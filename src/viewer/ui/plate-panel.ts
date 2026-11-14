/** Viewer UI: plate-panel (split out of app.ts; shares the viewer's state through `ctx`). */
import { h, icon } from "../dom";
import type { PlateData } from "../protocol";
import { fmtNum } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the plate-panel feature; returns its functions for the viewer to call. */
export function installPlatePanel(ctx: ViewerContext) {
  function togglePlate() {
    const { applySketchVisibility, assembly, plateCard, plateState, plateView, sketches, tb, updateInsets, viewport } = ctx;
    plateState.on = !plateState.on;
    tb.plate.classList.toggle("active", plateState.on);
    plateCard.classList.toggle("hidden", !plateState.on);
    viewport.clearHover();
    if (plateState.on) {
      // Joints and sketches belong to the assembled model, not the plate.
      assembly.root.visible = false;
      sketches.setVisible(false);
      void runPlate();
    } else {
      plateView.clear(true, [...viewport.parts.keys()]);
      plateState.data = undefined;
      assembly.root.visible = assembly.showAnchors;
      applySketchVisibility();
      viewport.fit();
    }
    renderPlate();
    queueMicrotask(updateInsets);
  }
  /** Orient + pack the current parts in the worker, then show the beds (latest wins). */
  async function runPlate(download = false) {
    const { plateState, plateView, request, state, toast, viewport } = ctx;
    if (!plateState.on) return;
    if (plateState.busy && !download) return void (plateState.again = true);
    plateState.busy = true;
    renderPlate();
    const res = await request<{ result?: PlateData; files?: Uint8Array[]; error?: string }>({ type: "plate", bed: plateState.bed, spacing: plateState.spacing, orient: plateState.orient, download });
    plateState.busy = false;
    if (!plateState.on) return;
    plateState.error = res.error ?? "";
    if (res.result) {
      const first = !plateState.data;
      plateState.data = res.result;
      plateView.show(res.result, [...viewport.parts.keys()]);
      if (first) viewport.setView("iso");
    }
    if (download && res.files) {
      const base = state.file.replace(/^.*\//, "").replace(/\.[jt]sx?$/, "");
      res.files.forEach((f, i) => {
        const a = h("a", { href: URL.createObjectURL(new Blob([f as BlobPart], { type: "model/3mf" })), download: `${base}-plate${res.files!.length > 1 ? `-${i + 1}` : ""}.3mf` });
        a.click();
      });
      toast(`${res.files.length} plate${res.files.length > 1 ? "s" : ""} saved as 3MF`);
    }
    renderPlate();
    if (plateState.again) {
      plateState.again = false;
      void runPlate();
    }
  }
  function renderPlate() {
    const { plateBody, plateState } = ctx;
    plateBody.replaceChildren();
    const num = (value: number, step: number, set: (v: number) => void) => {
      const i = h("input", { type: "number", value: String(value), step: String(step), min: "1", class: "num" }) as HTMLInputElement;
      i.addEventListener("change", () => {
        const v = Number(i.value);
        if (v > 0) {
          set(v);
          try {
            localStorage.setItem("tscad.bed", JSON.stringify(plateState.bed));
          } catch {
            /* private */
          }
          void runPlate();
        }
      });
      return h("div", { class: "num-wrap sm" }, i, h("span", { class: "unit" }, "mm"));
    };
    const orient = h(
      "div",
      { class: "segmented sm" },
      ...(["auto", "keep"] as const).map((o) => h("button", { class: plateState.orient === o ? "active" : "", title: o === "auto" ? "Least overhang" : "As modelled", onclick: () => { plateState.orient = o; void runPlate(); } }, o === "auto" ? "Best" : "As modelled")),
    );
    plateBody.append(
      h("div", { class: "plate-row" }, h("span", null, "Bed"), num(plateState.bed[0], 1, (v) => (plateState.bed = [v, plateState.bed[1]])), h("span", { class: "muted" }, "×"), num(plateState.bed[1], 1, (v) => (plateState.bed = [plateState.bed[0], v]))),
      h("div", { class: "plate-row" }, h("span", null, "Spacing"), num(plateState.spacing, 0.5, (v) => (plateState.spacing = v)), orient),
    );
    if (plateState.error) plateBody.append(h("div", { class: "warning" }, icon("alert", 12), plateState.error));
    const d = plateState.data;
    if (!d) {
      plateBody.append(h("div", { class: "skeleton" }));
      return;
    }
    plateBody.append(h("div", { class: "diff-head muted" }, `${d.plates} plate${d.plates === 1 ? "" : "s"}${plateState.busy ? " · updating…" : ""}`));
    for (const it of d.items) {
      plateBody.append(
        h(
          "div",
          { class: "diff-row" },
          h("div", { class: "diff-name" }, it.name, d.plates > 1 ? h("span", { class: "chip" }, `plate ${it.plate + 1}`) : null),
          h("div", { class: "diff-nums" }, h("span", null, `bottom ${it.bottom}`), h("span", { class: it.overhangArea < 1 ? "add" : "rem" }, it.overhangArea < 1 ? "no overhang" : `${(it.overhang * 100).toFixed(1)}% overhang`)),
          h("div", { class: "diff-size muted" }, `height ${fmtNum(it.height, 1)} mm${it.rotated90 ? " · turned 90°" : ""}`),
        ),
      );
    }
    plateBody.append(h("button", { class: "btn primary plate-dl", onclick: () => void runPlate(true) }, icon("download", 14), h("span", null, d.plates > 1 ? `Download ${d.plates} plates (3MF)` : "Download plate (3MF)")));
  }
  return { renderPlate, runPlate, togglePlate, };
}
