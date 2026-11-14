/** The playground's "Import .scad" dialog, and the notes header put on converted files. */
import { h, icon } from "../viewer/dom";
import type { EditorProblem } from "./editor";

export const NOTES_HEAD = "// Converted from OpenSCAD";

/**
 * Put the converter's notes at the top of the TSX as comments, and return them as editor
 * warnings on those lines (the notes refer to .scad lines, which don't exist in the TSX).
 */
export function withNotes(tsx: string, warnings: { line: number; message: string }[], file: string): { text: string; notes: EditorProblem[] } {
  if (!warnings.length) return { text: `${NOTES_HEAD} (${file}).\n${tsx}`, notes: [] };
  const lines = [`${NOTES_HEAD} (${file}). Check these, they didn't convert exactly:`];
  const notes: EditorProblem[] = [];
  for (const w of warnings) {
    lines.push(`//   ${file}:${w.line}: ${w.message}`);
    notes.push({ line: lines.length, column: 6, message: `${file} line ${w.line}: ${w.message}`, severity: "warning" });
  }
  return { text: `${lines.join("\n")}\n${tsx}`, notes };
}

/**
 * Show the import dialog. `convert` returns an error message to show, or undefined when it
 * worked (the dialog then closes).
 */
export function scadImportDialog(host: HTMLElement, convert: (source: string, fileName?: string) => string | undefined) {
  const area = h("textarea", { class: "scad-input", placeholder: "Paste OpenSCAD here, or choose a .scad file…", spellcheck: false }) as HTMLTextAreaElement;
  const fileInput = h("input", { type: "file", accept: ".scad,text/plain", class: "hidden" }) as HTMLInputElement;
  const err = h("div", { class: "scad-error hidden" });
  let fileName: string | undefined;
  const close = () => {
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const go = () => {
    const msg = convert(area.value, fileName);
    if (msg === undefined) return close();
    err.textContent = msg;
    err.classList.remove("hidden");
  };
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    fileName = f.name;
    area.value = await f.text();
    go();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  const dialog = h(
    "div",
    { class: "scad-dialog", role: "dialog", "aria-label": "Import OpenSCAD" },
    h("div", { class: "scad-head" }, icon("file", 15), h("b", null, "Import OpenSCAD"), h("span", { class: "spacer" }), h("button", { class: "icon-btn sm", title: "Close (Esc)", onclick: close }, icon("x", 14))),
    h("p", { class: "muted" }, "Modules become components, variables with customizer ranges become params, and anything that doesn't convert exactly is listed at the top of the file."),
    area,
    err,
    h(
      "div",
      { class: "scad-actions" },
      h("button", { class: "btn", onclick: () => fileInput.click() }, icon("file", 14), h("span", null, "Choose file…")),
      fileInput,
      h("span", { class: "spacer" }),
      h("button", { class: "btn primary", onclick: () => ((fileName ??= undefined), go()) }, h("span", null, "Convert"), h("kbd", null, "⌘↵")),
    ),
  );
  const overlay = h("div", { class: "scad-overlay", onclick: (e: Event) => e.target === overlay && close() }, dialog);
  host.append(overlay);
  area.focus();
}
