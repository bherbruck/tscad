/** Viewer UI: sketch-drag (split out of app.ts; shares the viewer's state through `ctx`). */
import type { SketchChange, SketchDragData } from "../protocol";
import type { SketchEditResult } from "../app";
import { fmtNum } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the sketch-drag feature; returns its functions for the viewer to call. */
export function installSketchDrag(ctx: ViewerContext) {
  let sketchDrag:
    | { sketch: number; id: string; free: boolean; target?: [number, number]; inflight: boolean; queued: boolean; result?: SketchDragData; shift: boolean }
    | undefined;
  /** Re-solve for the latest cursor position (one request in flight, latest wins). */
  async function solveDrag() {
    const { request, showTip, sketches } = ctx;
    const d = sketchDrag;
    if (!d?.target) return;
    if (d.inflight) return void (d.queued = true);
    d.inflight = true;
    const res = await request<{ result?: SketchDragData; error?: string }>({ type: "sketch-drag", sketch: d.sketch, point: d.id, target: d.target, changeDimensions: d.shift });
    d.inflight = false;
    if (sketchDrag !== d) return;
    if (res.result) {
      d.result = res.result;
      sketches.showPreview(d.sketch, res.result.entities, res.result.points, d.id, res.result.reached);
      const b = res.result.blockedBy[0];
      showTip(res.result.reached ? `${d.id} → ${d.target.map((v) => fmtNum(v)).join(", ")}${d.shift ? " · changing dimensions" : ""}` : `held by ${b?.label ?? "constraints"}${b?.loc ? ` (line ${b.loc.line})` : ""} — Shift to change it`);
    } else if (res.error) showTip(res.error);
    if (d.queued) {
      d.queued = false;
      void solveDrag();
    }
  }
  /** Drop: write the edits that make the drag the design (or move a param slider). */
  async function finishDrag(d: NonNullable<typeof sketchDrag>) {
    const { cfg, params, sketches, toast } = ctx;
    while (d.inflight) await new Promise((r) => setTimeout(r, 20));
    const r = d.result;
    sketches.clearPreview();
    if (!r || !d.target) return;
    const params_: { name: string; value: number }[] = [];
    const textual = r.changes.filter((c) => {
      if (c.kind === "prop" && c.param) {
        params_.push(c.param);
        return false;
      }
      return true;
    });
    for (const p of params_) params.setValue(p.name, p.value, true);
    if (!textual.length) {
      if (!params_.length) toast(r.blockedBy[0] ? `Nothing to change: held by ${r.blockedBy[0].label}` : "Nothing to change");
      else toast(`Moved ${params_.map((p) => `${p.name} → ${fmtNum(p.value)}`).join(", ")}`);
      return;
    }
    const apply = cfg.onSketchEdit ?? (cfg.ws ? serverEdit : undefined);
    if (!apply) return void toast("This viewer can't edit the source");
    const res = await apply(textual);
    if (res.error) return void toast(`Edit failed: ${res.error}`);
    for (const f of res.refused) if (f.param) params.setValue(f.param.name, f.param.value, true);
    const msg = [res.applied ? `${res.applied} edit${res.applied > 1 ? "s" : ""} written` : "", params_.length ? `moved ${params_.map((p) => p.name).join(", ")}` : "", res.refused.filter((f) => !f.param).map((f) => f.reason)[0] ?? ""].filter(Boolean).join(" · ");
    toast(msg || "No change");
  }
  async function serverEdit(changes: SketchChange[]): Promise<SketchEditResult> {
    try {
      const r = await fetch("/__edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes }) });
      return (await r.json()) as SketchEditResult;
    } catch (e) {
      return { applied: 0, refused: [], error: String((e as Error).message) };
    }
  }
  return { finishDrag, serverEdit, solveDrag,
    get sketchDrag() {
      return sketchDrag;
    },
    set sketchDrag(v) {
      sketchDrag = v;
    }, };
}
