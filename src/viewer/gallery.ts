/**
 * `tscad dev <folder>`: a gallery of every model in the folder. Thumbnails come from the dev
 * server (rendered in the background, cached in .tscad/cache) and update live as files change.
 */
import { h, icon, LOGO } from "./dom";

interface ThumbInfo {
  ok: boolean;
  parts: number;
  volume: number;
  error?: string;
  png?: string;
}

interface Item {
  rel: string;
  title: string;
  description: string;
  mtime: number;
  thumb: ThumbInfo | null;
}

const root = document.getElementById("gallery")!;
const grid = h("div", { class: "g-grid" });
const search = h("input", { type: "search", class: "g-search", placeholder: "Filter models…", spellcheck: false }) as HTMLInputElement;
const sort = h("select", { class: "g-sort", title: "Sort" }, h("option", { value: "name" }, "Name"), h("option", { value: "mtime" }, "Recently changed")) as HTMLSelectElement;
const count = h("span", { class: "g-count muted" });
const folder = h("span", { class: "file" }, icon("layers", 14), h("span"));
let items: Item[] = [];
const cards = new Map<string, HTMLElement>();

root.append(
  h(
    "header",
    { class: "topbar" },
    h("div", { class: "brand", html: `${LOGO}<span>tscad</span>` }),
    h("div", { class: "sep" }),
    folder,
    count,
    h("div", { class: "spacer" }),
    h("label", { class: "g-search-wrap" }, icon("cursor", 14), search),
    sort,
  ),
  h("main", { class: "g-main" }, grid),
);

const fmtVol = (v: number) => (v >= 1e5 ? `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} cm³` : `${Math.round(v).toLocaleString("en-US")} mm³`);
function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function card(it: Item): HTMLElement {
  const t = it.thumb;
  const thumb = !t
    ? h("div", { class: "g-thumb pending" }, h("div", { class: "skeleton" }), h("span", { class: "g-pending muted" }, "rendering…"))
    : t.png
      ? h("div", { class: "g-thumb" }, h("img", { src: `/__thumb/${t.png}`, alt: it.title, loading: "lazy" }))
      : h("div", { class: "g-thumb failed" }, icon("alert", 22), h("span", null, "doesn't build"));
  const meta = t ? (t.ok ? `${t.parts} part${t.parts === 1 ? "" : "s"} · ${fmtVol(t.volume)}` : "error") : "…";
  const el = h(
    "a",
    { class: `g-card${t && !t.ok ? " has-error" : ""}`, href: `/view/${it.rel.split("/").map(encodeURIComponent).join("/")}`, title: it.description || it.title },
    thumb,
    h(
      "div",
      { class: "g-body" },
      h("div", { class: "g-title" }, it.title, t && !t.ok ? h("span", { class: "sk-chip bad" }, icon("x", 10), "error") : null),
      h("div", { class: "g-path muted" }, it.rel),
      it.description ? h("div", { class: "g-desc" }, it.description) : null,
      t?.error ? h("div", { class: "g-error" }, t.error) : null,
      h("div", { class: "g-meta muted" }, h("span", null, meta), h("span", null, ago(it.mtime))),
    ),
  );
  return el;
}

function render() {
  const q = search.value.trim().toLowerCase();
  const shown = items
    .filter((it) => !q || `${it.title} ${it.rel} ${it.description}`.toLowerCase().includes(q))
    .sort((a, b) => (sort.value === "mtime" ? b.mtime - a.mtime : a.rel.localeCompare(b.rel)));
  grid.replaceChildren();
  cards.clear();
  for (const it of shown) {
    const c = card(it);
    cards.set(it.rel, c);
    grid.append(c);
  }
  count.textContent = q ? `${shown.length} of ${items.length}` : `${items.length} model${items.length === 1 ? "" : "s"}`;
  if (!items.length) grid.append(h("div", { class: "g-empty" }, h("b", null, "No models here yet."), h("p", { class: "muted" }, "A model is a .tsx file that imports tscad and has a default export. Run ", h("code", null, "bunx tscad init"), " to make one.")));
  else if (!shown.length) grid.append(h("div", { class: "g-empty muted" }, "Nothing matches."));
}

async function load() {
  const r = await fetch("/__gallery");
  const body = (await r.json()) as { root: string; items: Item[] };
  items = body.items;
  folder.querySelector("span")!.textContent = body.root.split(/[\\/]/).pop() ?? body.root;
  document.title = `${folder.textContent} · tscad`;
  render();
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__ws`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "gallery") {
      const it = items.find((x) => x.rel === m.rel);
      if (!it) return void load();
      it.thumb = m.info;
      const old = cards.get(m.rel);
      if (old) {
        const fresh = card(it);
        old.replaceWith(fresh);
        cards.set(m.rel, fresh);
      }
    } else if (m.type === "gallery-changed") void load();
  };
  ws.onclose = () => setTimeout(connect, 1000);
}

search.addEventListener("input", render);
sort.addEventListener("change", render);
window.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== search) {
    e.preventDefault();
    search.focus();
  }
});
void load();
connect();
