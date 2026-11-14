/** Viewer UI: parts (split out of app.ts; shares the viewer's state through `ctx`). */
import { h, icon } from "../dom";
import { drawingMeta } from "../fmt";
import { fmtMs, fmtVol, fmtMass, shortFile, toHexColor } from "./format";
import { fmtNum, PALETTE } from "../scene";
import type { ViewerContext } from "./context";

/** Installs the parts feature; returns its functions for the viewer to call. */
export function installParts(ctx: ViewerContext) {
  let isolated: string | undefined;
  function renderParts() {
    const { assembly, partsList, sourceClick, state, viewport } = ctx;
    const d = state.data;
    partsList.replaceChildren();
    if (!d) return void partsList.append(h("div", { class: "empty pad" }, "Parts appear here once the model builds."));
    d.parts.forEach((p, i) => {
      const view = viewport.parts.get(p.name);
      const color = state.colors[p.name] ?? p.color ?? PALETTE[i % PALETTE.length]!;
      const visible = view ? view.visible : true;
      const swatch = h("input", { type: "color", value: toHexColor(color), class: "swatch-input", title: "Display colour" }) as HTMLInputElement;
      swatch.addEventListener("input", () => {
        state.colors[p.name] = swatch.value;
        (swatch.parentElement as HTMLElement).style.setProperty("--c", swatch.value);
        viewport.setPartColor(p.name, swatch.value);
      });
      const eye = h("button", { class: "icon-btn sm", title: visible ? "Hide" : "Show", onclick: () => { viewport.setPartVisible(p.name, !(viewport.parts.get(p.name)?.visible ?? true)); isolated = undefined; renderParts(); } }, icon(visible ? "eye" : "eyeOff", 14));
      const iso = h("button", { class: `icon-btn sm${isolated === p.name ? " active" : ""}`, title: "Isolate", onclick: () => isolate(p.name) }, icon("target", 14));
      const asmPart = d.assembly?.parts.find((x) => x.name === p.name);
      const meta: string[] = [];
      if (asmPart && asmPart.dof > 0) meta.push(`⚠ ${asmPart.dof} DOF free`);
      if (asmPart?.grounded) meta.push("grounded");
      if (p.ok && p.volume !== undefined) meta.push(fmtVol(p.volume));
      if (p.ok && p.density !== undefined && p.volume !== undefined) meta.push(fmtMass((p.volume / 1000) * p.density));
      if (p.counts) meta.push(`${p.counts[0]}F ${p.counts[1]}E`);
      const el = h(
        "div",
        { class: `part${visible ? "" : " hidden-part"}${p.ok ? "" : " failed"}` },
        h("label", { class: "swatch", style: { "--c": color } as any }, swatch),
        h(
          "div",
          { class: "part-main" },
          h("div", { class: "part-name" }, p.name, p.cached ? h("span", { class: "cache-chip", title: "From the kernel cache" }, icon("zap", 10)) : null, p.material ? h("span", { class: "chip" }, p.material) : null),
          h("div", { class: "part-meta" }, p.ok ? meta.join(" · ") : p.error ? `${p.error.op} failed` : "failed"),
        ),
        h("div", { class: "part-actions" }, iso, eye),
      );
      el.addEventListener("mouseenter", () => p.bbox && el.classList.add("hover"));
      el.addEventListener("mouseleave", () => el.classList.remove("hover"));
      el.title = p.bbox ? `${p.name}\nbbox ${p.bbox[0].map((v) => fmtNum(v)).join(", ")} → ${p.bbox[1].map((v) => fmtNum(v)).join(", ")}\n${p.counts ? `${p.counts[0]} faces, ${p.counts[1]} edges, ${p.counts[2]} vertices` : ""}\n${fmtMs(p.millis)}` : p.name;
      partsList.append(el);
    });
    if (d.assembly?.mates.length) {
      if (d.parts.length > 1) {
        const ex = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: String(assembly.explode) }) as HTMLInputElement;
        const paint = () => ex.style.setProperty("--fill", `${Number(ex.value) * 100}%`);
        paint();
        ex.addEventListener("input", () => {
          paint();
          assembly.setExplode(Number(ex.value));
        });
        partsList.prepend(h("div", { class: "explode-row" }, h("span", null, "Explode"), ex));
      }
      for (const m of d.assembly.mates) {
        const val = [m.angle !== undefined ? `${+m.angle.toFixed(2)}°` : "", m.offset !== undefined ? `${+m.offset.toFixed(2)} mm` : ""].filter(Boolean).join(" ");
        const drive = [m.drive?.angle?.param, m.drive?.offset?.param].filter(Boolean);
        const chip = m.ok ? h("span", { class: "sk-chip ok", title: `residual ${m.residual.toExponential(1)} mm` }, icon("check", 11), "ok") : h("span", { class: "sk-chip bad", title: `residual ${m.residual.toFixed(3)} mm` }, icon("x", 11), "unsolved");
        const row = h(
          "button",
          { class: "part sketch-row", title: `${m.type} mate${m.loc ? `. Click to show it in the code (${shortFile(m.loc.file)}:${m.loc.line})` : ""}${drive.length ? `\ndriven by ${drive.join(", ")}: drag its gizmo` : ""}` },
          h("span", { class: "swatch mate-swatch" }, icon(m.type === "slider" ? "slider" : m.type === "fastened" ? "link" : "joint", 12)),
          h(
            "div",
            { class: "part-main" },
            h("div", { class: "part-name" }, m.type, chip, drive.length ? h("span", { class: "chip" }, drive.join(", ")) : null),
            h("div", { class: "part-meta" }, `${m.a} → ${m.b}${val ? ` · ${val}` : ""}`),
          ),
        );
        row.addEventListener("click", () => m.loc && sourceClick(m.loc, { kind: "mate", mate: m }));
        partsList.append(row);
      }
    }
    (d.sketches ?? []).forEach((sk, i) => {
      const status = sk.status === "ok" ? "ok" : sk.status === "under" ? "under" : "bad";
      const chip =
        status === "ok"
          ? h("span", { class: "sk-chip ok", title: "Fully constrained" }, icon("check", 11), "constrained")
          : status === "under"
            ? h("span", { class: "sk-chip under", title: `Still free:\n${sk.free.join("\n")}` }, icon("alert", 11), `${sk.dof} DOF`)
            : h("span", { class: "sk-chip bad", title: sk.free.join("\n") || sk.status }, icon("x", 11), "conflict");
      const where = sk.loc ? `${shortFile(sk.loc.file)}:${sk.loc.line}` : sk.path;
      const row = h(
        "button",
        { class: "part sketch-row", title: sk.loc ? `Sketch ${i + 1}. Click to show it in the code (${where})` : `Sketch ${i + 1}` },
        h("span", { class: "swatch sketch-swatch" }, icon("sketch", 12)),
        h("div", { class: "part-main" }, h("div", { class: "part-name" }, `Sketch ${i + 1}`, chip), h("div", { class: "part-meta" }, `${sk.part ?? "part"} · ${sk.entities.length} curves · ${sk.dimensions.length} dims · ${where}`)),
      );
      row.addEventListener("click", () => sk.loc && sourceClick(sk.loc, { kind: "sketch", sketch: sk }));
      partsList.append(row);
    });
    for (const dr of d.drawings ?? []) {
      const v = viewport.drawings.get(dr.name);
      const visible = v?.visible ?? true;
      const eye = h("button", { class: "icon-btn sm", title: visible ? "Hide" : "Show", onclick: () => { viewport.setDrawingVisible(dr.name, !visible); renderParts(); } }, icon(visible ? "eye" : "eyeOff", 14));
      partsList.append(
        h(
          "div",
          { class: `part${visible ? "" : " hidden-part"}`, title: `${dr.name}: a flat drawing. Export it with tscad build -o ${dr.name}.dxf` },
          h("span", { class: "swatch drawing-swatch", style: { "--c": v?.color ?? dr.color ?? "#ffb020" } }),
          h("div", { class: "part-main" }, h("div", { class: "part-name" }, dr.name, h("span", { class: "chip" }, "2D")), h("div", { class: "part-meta" }, drawingMeta(dr))),
          h("div", { class: "part-actions" }, eye),
        ),
      );
    }
  }
  function isolate(name: string) {
    const { state, viewport } = ctx;
    const d = state.data;
    if (!d) return;
    isolated = isolated === name ? undefined : name;
    for (const p of d.parts) viewport.setPartVisible(p.name, !isolated || p.name === isolated);
    renderParts();
    viewport.fit();
  }
  return { isolate, renderParts,
    get isolated() {
      return isolated;
    },
    set isolated(v) {
      isolated = v;
    }, };
}
