/** Viewer UI: export-menu (split out of app.ts; shares the viewer's state through `ctx`). */
import { h } from "../dom";
import { fmtMs, fmtBytes } from "./format";
import type { ExportFormat } from "../protocol";
import type { ViewerContext } from "./context";

/** The export formats offered in the menu. */
export const FORMATS: { id: ExportFormat; name: string; desc: string; ext: string; mime: string }[] = [
  { id: "step", name: "STEP", desc: "Exact B-rep · CAD interchange", ext: "step", mime: "model/step" },
  { id: "stl", name: "STL", desc: "Binary mesh · 3D printing", ext: "stl", mime: "model/stl" },
  { id: "3mf", name: "3MF", desc: "Mesh with colours · slicers", ext: "3mf", mime: "model/3mf" },
  { id: "glb", name: "GLB", desc: "glTF binary · web & AR", ext: "glb", mime: "model/gltf-binary" },
  { id: "obj", name: "OBJ", desc: "Wavefront mesh", ext: "obj", mime: "model/obj" },
  { id: "dxf", name: "DXF", desc: "2D · drawings, or a mid-height section", ext: "dxf", mime: "image/vnd.dxf" },
  { id: "svg", name: "SVG", desc: "2D · laser cutters & docs", ext: "svg", mime: "image/svg+xml" },
];

/** Installs the export-menu feature; returns its functions for the viewer to call. */
export function installExportMenu(ctx: ViewerContext) {
  function buildExportMenu() {
    // `helpPop` is built after this menu: read it from ctx when clicked.
    const { exportBtn } = ctx;
    let tol = 0.01;
    const tolSeg = h(
      "div",
      { class: "segmented sm" },
      ...[
        ["Draft", 0.1],
        ["Normal", 0.01],
        ["Fine", 0.002],
      ].map(([label, v]) => h("button", { class: v === tol ? "active" : "", onclick: (e: Event) => { tol = v as number; for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.classList.toggle("active", b === e.currentTarget); } }, String(label))),
    );
    const menu = h(
      "div",
      { class: "menu export-menu hidden" },
      ...FORMATS.map((f) =>
        h(
          "button",
          { class: "menu-item", onclick: () => doExport(f, tol) },
          h("span", { class: `fmt fmt-${f.id}` }, f.name),
          h("span", { class: "menu-desc" }, f.desc),
          h("span", { class: "kbd-hint" }, `.${f.ext}`),
        ),
      ),
      h("div", { class: "menu-foot" }, h("span", null, "Mesh tolerance"), tolSeg),
    );
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
      ctx.helpPop.classList.add("hidden");
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target as Node)) menu.classList.add("hidden");
    });
    return menu;
  }
  async function doExport(f: (typeof FORMATS)[number], tolerance: number) {
    const { exportMenu, request, state, toast, viewport } = ctx;
    exportMenu.classList.add("hidden");
    const d = state.data;
    if (!d) return toast("Nothing to export yet");
    const parts = d.parts.filter((p) => p.ok && !p.empty && (viewport.parts.get(p.name)?.visible ?? true)).map((p) => ({ name: p.name, color: state.colors[p.name] ?? p.color }));
    if (!parts.length && !((f.id === "dxf" || f.id === "svg") && d.drawings?.length)) return toast("No visible parts to export");
    const t = performance.now();
    const done = toast(`Exporting ${f.name}…`, true);
    const res = await request<{ data?: Uint8Array | string; error?: string }>({ type: "export", format: f.id, parts, tolerance });
    done();
    if (res.error || res.data === undefined) return toast(`Export failed: ${res.error}`);
    const base = state.file.replace(/^.*\//, "").replace(/\.[jt]sx?$/, "");
    const name = parts.length === 1 && d.parts.length > 1 ? `${base}-${parts[0]!.name}` : base;
    const blob = new Blob([res.data as BlobPart], { type: f.mime });
    const a = h("a", { href: URL.createObjectURL(blob), download: `${name}.${f.ext}` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${name}.${f.ext} · ${fmtBytes(blob.size)} · ${fmtMs(performance.now() - t)}`);
  }
  return { buildExportMenu, doExport, };
}
