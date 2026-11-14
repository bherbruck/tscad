/** The auto-generated parameters panel, and param values ⇄ URL hash. */
import { h, icon } from "./dom";
import type { ParamSchemaData, ParamSpec, ParamValuesData } from "./protocol";

type Opt = { value: string | number; label: string };

function options(spec: ParamSpec): Opt[] {
  const labels = (spec.optionLabels ?? {}) as Record<string, string>;
  return (spec.options ?? []).map((o) => (typeof o === "object" ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: labels[String(o)] ?? String(o) }));
}

function kind(spec: ParamSpec): "number" | "int" | "boolean" | "choice" | "color" | "text" {
  const t = String(spec.type ?? "").toLowerCase();
  if (t === "int" || t === "integer") return "int";
  if (t === "number" || t === "float" || t === "length" || t === "angle") return "number";
  if (t === "boolean" || t === "bool" || t === "toggle") return "boolean";
  if (t === "choice" || t === "select" || t === "enum" || spec.options) return "choice";
  if (t === "color" || t === "colour") return "color";
  return typeof spec.default === "number" ? "number" : typeof spec.default === "boolean" ? "boolean" : "text";
}

const humanize = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Hash keys that are never params (the playground's shared source). */
export const RESERVED = new Set(["code", "example", "files"]);

/** Values that differ from defaults, as a hash string (`a=1&b=x`). */
export function valuesToHash(schema: ParamSchemaData, values: ParamValuesData): string {
  const q = new URLSearchParams();
  for (const [k, spec] of Object.entries(schema)) {
    const v = values[k];
    if (v === undefined || v === spec.default) continue;
    q.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return q.toString();
}

/** Parse the hash with the schema's types (unknown keys kept as strings until the schema arrives). */
export function hashToValues(hash: string, schema?: ParamSchemaData): ParamValuesData {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const out: ParamValuesData = {};
  for (const [k, raw] of q) {
    if (RESERVED.has(k)) continue;
    const spec = schema?.[k];
    if (schema && !spec) continue;
    out[k] = spec ? coerce(spec, raw) : guess(raw);
  }
  return out;
}

function guess(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !isNaN(Number(raw))) return Number(raw);
  return raw;
}

function coerce(spec: ParamSpec, raw: string): unknown {
  switch (kind(spec)) {
    case "number":
      return Number(raw);
    case "int":
      return Math.round(Number(raw));
    case "boolean":
      return raw === "1" || raw === "true";
    case "choice": {
      const o = options(spec).find((o) => String(o.value) === raw);
      return o ? o.value : raw;
    }
    default:
      return raw;
  }
}

export class ParamsPanel {
  readonly el: HTMLElement;
  #schema: ParamSchemaData = {};
  #values: ParamValuesData = {};
  #sig = "";
  #inputs = new Map<string, (v: unknown) => void>();
  onChange: (values: ParamValuesData, committed: boolean) => void = () => {};

  constructor() {
    this.el = h("div", { class: "params" });
  }

  get values() {
    return this.#values;
  }

  /** Show `schema` with `values`; rebuilds only when the schema's shape changed. */
  update(schema: ParamSchemaData, values: ParamValuesData) {
    this.#schema = schema;
    const sig = JSON.stringify(schema);
    this.#values = { ...values };
    if (sig !== this.#sig) {
      this.#sig = sig;
      this.#build();
    } else {
      for (const [k, set] of this.#inputs) set(this.#values[k]);
    }
  }

  /** Set one value as if the user moved its control (`committed` false while dragging). */
  setValue(key: string, value: unknown, committed = false) {
    const spec = this.#schema[key];
    if (!spec) return;
    let v = value;
    if (typeof v === "number") {
      if (spec.type === "int") v = Math.round(v);
      else if (spec.step) v = Number((Math.round(v / spec.step) * spec.step).toFixed(6));
      if (spec.min !== undefined) v = Math.max(spec.min, v as number);
      if (spec.max !== undefined) v = Math.min(spec.max, v as number);
    }
    if (v === this.#values[key] && !committed) return;
    this.#inputs.get(key)?.(v);
    this.#set(key, v, committed);
  }

  reset() {
    for (const [k, spec] of Object.entries(this.#schema)) this.#values[k] = spec.default;
    for (const [k, set] of this.#inputs) set(this.#values[k]);
    this.onChange({ ...this.#values }, true);
  }

  #set(key: string, v: unknown, committed: boolean) {
    this.#values[key] = v;
    this.el.querySelector(`[data-key="${CSS.escape(key)}"]`)?.classList.toggle("modified", v !== this.#schema[key]?.default);
    this.onChange({ ...this.#values }, committed);
  }

  #build() {
    this.#inputs.clear();
    this.el.replaceChildren();
    const entries = Object.entries(this.#schema);
    if (!entries.length) {
      this.el.append(h("div", { class: "empty" }, "No parameters. Export ", h("code", null, "params = defineParams({...})"), " to get sliders here."));
      return;
    }
    const groups = new Map<string, [string, ParamSpec][]>();
    for (const e of entries) {
      const g = e[1].group ?? "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(e);
    }
    for (const [g, items] of groups) {
      const box = h("div", { class: "param-group" });
      if (g) box.append(h("div", { class: "param-group-title" }, g));
      for (const [key, spec] of items) box.append(this.#row(key, spec));
      this.el.append(box);
    }
  }

  #row(key: string, spec: ParamSpec): HTMLElement {
    const k = kind(spec);
    const label = spec.label ?? humanize(key);
    const val = this.#values[key] ?? spec.default;
    const row = h("div", { class: `param param-${k}`, "data-key": key, title: spec.description ?? "" });
    const resetOne = h("button", { class: "param-reset", title: "Reset to default", onclick: () => { this.#inputs.get(key)?.(spec.default); this.#set(key, spec.default, true); } }, icon("reset", 12));
    const head = h("div", { class: "param-head" }, h("label", null, label), resetOne);
    row.append(head);
    if (val !== spec.default) row.classList.add("modified");

    if (k === "number" || k === "int") {
      const step = spec.step ?? (k === "int" ? 1 : guessStep(spec));
      const min = spec.min ?? Math.min(0, Number(spec.default ?? 0));
      const max = spec.max ?? Math.max(Number(spec.default ?? 1) * 4, 10);
      const range = h("input", { type: "range", min, max, step, value: String(val) }) as HTMLInputElement;
      const num = h("input", { type: "number", min: spec.min, max: spec.max, step, value: String(val), class: "num" }) as HTMLInputElement;
      const unit = spec.unit ? h("span", { class: "unit" }, spec.unit) : null;
      const paint = () => range.style.setProperty("--fill", `${((Number(range.value) - min) / (max - min || 1)) * 100}%`);
      range.addEventListener("input", () => {
        const v = k === "int" ? Math.round(Number(range.value)) : Number(range.value);
        num.value = String(v);
        paint();
        this.#set(key, v, false);
      });
      range.addEventListener("change", () => this.#set(key, Number(range.value), true));
      num.addEventListener("change", () => {
        let v = Number(num.value);
        if (!isFinite(v)) return;
        if (k === "int") v = Math.round(v);
        if (spec.min !== undefined) v = Math.max(spec.min, v);
        if (spec.max !== undefined) v = Math.min(spec.max, v);
        num.value = range.value = String(v);
        paint();
        this.#set(key, v, true);
      });
      // Scrub with arrow keys + shift for ×10.
      num.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
        let v = Number(num.value) + d;
        if (spec.min !== undefined) v = Math.max(spec.min, v);
        if (spec.max !== undefined) v = Math.min(spec.max, v);
        v = Number(v.toFixed(6));
        num.value = range.value = String(v);
        paint();
        this.#set(key, v, true);
      });
      paint();
      row.append(h("div", { class: "param-control" }, range, h("div", { class: "num-wrap" }, num, unit)));
      this.#inputs.set(key, (v) => {
        range.value = num.value = String(v);
        paint();
        row.classList.toggle("modified", v !== spec.default);
      });
    } else if (k === "boolean") {
      const input = h("input", { type: "checkbox", checked: !!val, class: "switch" }) as HTMLInputElement;
      input.addEventListener("change", () => this.#set(key, input.checked, true));
      head.prepend();
      row.append(h("div", { class: "param-control" }, h("label", { class: "switch-wrap" }, input, h("span", { class: "switch-ui" }), h("span", { class: "switch-text" }, input.checked ? "On" : "Off"))));
      input.addEventListener("change", () => (row.querySelector(".switch-text")!.textContent = input.checked ? "On" : "Off"));
      this.#inputs.set(key, (v) => {
        input.checked = !!v;
        row.querySelector(".switch-text")!.textContent = v ? "On" : "Off";
        row.classList.toggle("modified", v !== spec.default);
      });
    } else if (k === "choice") {
      const opts = options(spec);
      if (opts.length <= 4 && opts.every((o) => o.label.length <= 10)) {
        const seg = h("div", { class: "segmented" });
        const btns = opts.map((o) => {
          const b = h("button", { class: o.value === val ? "active" : "", onclick: () => { for (const x of btns) x.classList.toggle("active", x === b); this.#set(key, o.value, true); } }, o.label);
          return b;
        });
        seg.append(...btns);
        row.append(h("div", { class: "param-control" }, seg));
        this.#inputs.set(key, (v) => btns.forEach((b, i) => b.classList.toggle("active", opts[i]!.value === v)));
      } else {
        const sel = h("select", null, ...opts.map((o) => h("option", { value: String(o.value), selected: o.value === val }, o.label))) as HTMLSelectElement;
        sel.addEventListener("change", () => this.#set(key, opts[sel.selectedIndex]!.value, true));
        row.append(h("div", { class: "param-control" }, sel));
        this.#inputs.set(key, (v) => (sel.selectedIndex = Math.max(0, opts.findIndex((o) => o.value === v))));
      }
    } else if (k === "color") {
      const input = h("input", { type: "color", value: String(val ?? "#888888") }) as HTMLInputElement;
      const text = h("span", { class: "color-text" }, String(val));
      input.addEventListener("input", () => {
        text.textContent = input.value;
        this.#set(key, input.value, false);
      });
      input.addEventListener("change", () => this.#set(key, input.value, true));
      row.append(h("div", { class: "param-control color" }, h("label", { class: "color-wrap" }, input, text)));
      this.#inputs.set(key, (v) => {
        input.value = String(v);
        text.textContent = String(v);
      });
    } else {
      const input = h("input", { type: "text", value: String(val ?? "") }) as HTMLInputElement;
      input.addEventListener("input", () => this.#set(key, input.value, false));
      row.append(h("div", { class: "param-control" }, input));
      this.#inputs.set(key, (v) => (input.value = String(v ?? "")));
    }
    if (spec.description) row.append(h("div", { class: "param-desc" }, spec.description));
    return row;
  }
}

function guessStep(spec: ParamSpec): number {
  const span = (spec.max ?? 100) - (spec.min ?? 0);
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.1;
  return span <= 400 ? 0.5 : 1;
}
