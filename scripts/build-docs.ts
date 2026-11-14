#!/usr/bin/env bun
/**
 * Build the static docs website into dist/site/ (GitHub Pages root; the playground is mounted
 * at play/ when dist/playground/ exists).
 *
 *   bun scripts/build-docs.ts                 # build
 *   bun scripts/build-docs.ts --out <dir>     # build elsewhere
 *   bun scripts/build-docs.ts --serve 4700    # build, then serve locally
 *   bun scripts/build-docs.ts --no-render     # skip rendering the landing sample with the kernel
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { highlight } from "../site/highlight";
import { page, REPO, rootOf, type NavGroup } from "../site/layout";
import { escapeHtml, inline, renderMarkdown, slugify, type Heading } from "../site/md";
import { referenceEntries, type Entry } from "../src/mcp/reference";
import { encodeSource } from "../src/playground/share";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
let OUT = resolve(ROOT, flag("--out") ?? "dist/site");
let RENDER = !args.includes("--no-render");

const DOCS = join(ROOT, "docs");
const EXAMPLES = join(ROOT, "examples");
const CONTENT = join(ROOT, "site/content");

// ---------------------------------------------------------------------------------------------
// pages and navigation

interface DocPage {
  /** Output path relative to the site root. */
  path: string;
  title: string;
  src: string;
}

const docPages: DocPage[] = [
  { path: "docs/getting-started.html", title: "Getting started", src: join(CONTENT, "getting-started.md") },
  { path: "docs/guide.html", title: "Guide", src: join(DOCS, "guide.md") },
  { path: "docs/sketch.html", title: "Constraint sketches", src: join(DOCS, "sketch.md") },
  { path: "docs/assembly.html", title: "Assemblies & mates", src: join(DOCS, "assembly.md") },
  { path: "docs/selectors.html", title: "Selectors", src: join(CONTENT, "selectors.md") },
  { path: "docs/checks.html", title: "Checks & testing", src: join(DOCS, "checks.md") },
  { path: "docs/mcp.html", title: "MCP server (AI agents)", src: join(DOCS, "mcp.md") },
  { path: "docs/kernel.html", title: "Kernel notes", src: join(DOCS, "KERNEL_ISSUES.md") },
  { path: "docs/architecture.html", title: "Architecture", src: join(DOCS, "ARCHITECTURE.md") },
].filter((p) => existsSync(p.src));

const examples = existsSync(EXAMPLES)
  ? readdirSync(EXAMPLES)
      .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f))
      .sort()
      .map((f) => {
        const name = f.replace(/\.tsx$/, "");
        const source = readFileSync(join(EXAMPLES, f), "utf8");
        const doc = source.match(/^\/\*\*([\s\S]*?)\*\//)?.[1] ?? "";
        const summary = doc
          .split("\n")
          .map((l) => l.replace(/^\s*\*\s?/, "").trim())
          .filter((l) => l && !/^(tscad|bunx|\$)\s/.test(l))
          .join(" ");
        const image = existsSync(join(DOCS, "images", `${name}.png`)) ? `images/${name}.png` : undefined;
        return { name, title: titleCase(name), source, summary, image };
      })
  : [];

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and");
}

const GROUPS: [string, string, string[]][] = [
  ["Containers", "Parts, assemblies and groups: the structure of a model.", ["assembly", "part", "group", "drawing"]],
  ["Primitives", "Basic solids. Box, cylinder and cone sit centred in X/Y with their base on z = 0.", ["box", "cylinder", "cone", "sphere", "torus", "step"]],
  ["Booleans", "Combine solids.", ["union", "difference", "subtract", "intersection", "intersect"]],
  ["Transforms", "Move, turn, scale and mirror children (every solid also has placement props).", ["translate", "rotate", "scale", "mirror"]],
  ["Sketch shapes", "2D shapes, used inside extrude, revolve, loft, sweep and drawing. Nested loops become holes.", ["rect", "roundedRect", "circle", "ellipse", "polygon", "regularPolygon", "slot", "path", "star", "text", "sketch", "offset", "section"]],
  ["Sketch → solid", "Turn 2D shapes into solids.", ["extrude", "revolve", "loft", "sweep"]],
  ["Patterns", "Repeat children.", ["linearPattern", "gridPattern", "polarPattern"]],
  ["Features", "Round, bevel, hollow, draft, push/pull and split. Edges and faces are picked with selectors.", ["fillet", "chamfer", "shell", "draft", "pushPull", "offsetFaces", "split"]],
];

const ref = referenceEntries();
const PART_ORDER = ["Hole", "CounterboreHole", "CountersinkHole", "TapHole", "NutTrap", "HeatSetInsert", "Standoff", "BoltPattern", "MountHoles", "Extrusion2020", "HexPrism"];
ref.components.sort((a, b) => (PART_ORDER.indexOf(a.name) + 1 || 99) - (PART_ORDER.indexOf(b.name) + 1 || 99));
const grouped = new Set(GROUPS.flatMap((g) => g[2]));
const otherEls = ref.elements.filter((e) => !grouped.has(e.name));
const allGroups: [string, string, string[]][] = [
  ...GROUPS.map(([t, d, n]) => [t, d, n.filter((x) => ref.elements.some((e) => e.name === x))] as [string, string, string[]]),
  ...(otherEls.length ? [["Constraint sketch", "Elements of constraint-solved sketches (see Constraint sketches).", otherEls.map((e) => e.name)] as [string, string, string[]]] : []),
];

const sidebar: NavGroup[] = [
  { title: "Start", items: docPages.filter((p) => ["docs/getting-started.html", "docs/guide.html", "docs/sketch.html", "docs/assembly.html"].includes(p.path)).map((p) => ({ title: p.title, href: p.path })) },
  {
    title: "Reference",
    items: [
      { title: "Elements", href: "reference/elements.html", sub: allGroups.map(([t]) => ({ title: t, href: `reference/elements.html#${slugify(t)}` })) },
      { title: "Parts library", href: "reference/parts.html" },
      { title: "Selectors", href: "docs/selectors.html" },
      { title: "API", href: "reference/api.html" },
    ],
  },
  { title: "More", items: [...docPages.filter((p) => ["docs/checks.html", "docs/mcp.html", "docs/kernel.html", "docs/architecture.html"].includes(p.path)).map((p) => ({ title: p.title, href: p.path })), { title: "Gallery", href: "gallery/index.html" }] },
];

// ---------------------------------------------------------------------------------------------
// markdown with site-aware links

const DOC_LINKS: Record<string, string> = {
  "guide.md": "docs/guide.html",
  "mcp.md": "docs/mcp.html",
  "checks.md": "docs/checks.html",
  "sketch.md": "docs/sketch.html",
  "KERNEL_ISSUES.md": "docs/kernel.html",
  "ARCHITECTURE.md": "docs/architecture.html",
  "getting-started.md": "docs/getting-started.html",
  "selectors.md": "docs/selectors.html",
  "assembly.md": "docs/assembly.html",
  "api.md": "reference/api.html",
};

/** Rewrite a markdown URL found in `srcFile`, for a page at `pagePath`. */
function rewrite(href: string, srcFile: string, pagePath: string, kind: "link" | "image"): string {
  if (/^([a-z]+:|#|\/\/)/i.test(href)) return href;
  const r = rootOf(pagePath);
  const [pathPart, hash = ""] = href.split("#");
  // links written for the site (`../reference/elements.html`) are relative to the page
  if (/\.html$/.test(pathPart!)) return href;
  const abs = resolve(dirname(srcFile), pathPart!);
  const relRepo = abs.startsWith(ROOT) ? abs.slice(ROOT.length + 1) : pathPart!;
  if (kind === "image" || /\.(png|jpe?g|svg|gif|webp)$/i.test(abs)) {
    const m = relRepo.match(/^docs\/images\/(.+)$/);
    if (m) return `${r}images/${m[1]}`;
  }
  const base = relRepo.split("/").pop()!;
  if (relRepo.startsWith("docs/") || relRepo.startsWith("site/content/")) {
    const target = DOC_LINKS[base];
    if (target && docPages.some((p) => p.path === target)) return `${r}${target}${hash ? `#${hash}` : ""}`;
  }
  const ex = relRepo.match(/^examples\/([\w-]+)\.tsx$/);
  if (ex && examples.some((e) => e.name === ex[1])) return `${r}gallery/${ex[1]}.html`;
  if (!pathPart) return href;
  // anything else in the repo → GitHub
  if (abs.startsWith(ROOT)) return `${REPO}/blob/main/${relRepo}${hash ? `#${hash}` : ""}`;
  return href;
}

function md(src: string, srcFile: string, pagePath: string) {
  return renderMarkdown(src, { highlight, url: (h, k) => rewrite(h, srcFile, pagePath, k) });
}

// ---------------------------------------------------------------------------------------------
// writers

const written = new Set<string>();
function write(path: string, html: string) {
  const f = join(OUT, path);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, html);
  written.add(path);
}

const playLink = (r: string, e: { name?: string; source?: string }) => (e.name ? `${r}play/#example=${encodeURIComponent(e.name)}` : `${r}play/#code=${encodeSource(e.source!)}`);

function docPagesOut() {
  for (const p of docPages) {
    const { html, headings, title } = md(readFileSync(p.src, "utf8"), p.src, p.path);
    write(p.path, page({ path: p.path, title: title ?? p.title, body: html, section: "docs", sidebar, toc: headings }));
  }
}

function propsTable(e: Entry): string {
  if (!e.props.length) return "";
  const rows = e.props
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.name)}${m.optional ? "" : '<span class="req" title="required">*</span>'}</td><td>${escapeHtml(m.type)}</td><td>${docInline(m.doc)}</td></tr>`,
    )
    .join("");
  return `<div class="table-wrap"><table><thead><tr><th>Prop</th><th>Type</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** TSDoc text → inline HTML (backticks, emphasis) with @example blocks as code. */
function docInline(doc: string): string {
  const [text, ...ex] = doc.split(/\n?@example\s*/);
  let html = inline(text!.trim(), { opts: {} });
  for (const e of ex) html += `<pre class="code" data-lang="tsx"><code>${highlight(e.trim(), "tsx")}</code></pre>`;
  return html;
}

function sharedNote(e: Entry, r: string): string {
  if (!e.shared.length) return "";
  const links = e.shared.map((s) => {
    if (s.startsWith("placement")) return `<a href="${r}reference/elements.html#placement">placement props</a>`;
    if (s.startsWith("2D placement")) return `<a href="${r}reference/elements.html#placement2d">2D placement props</a>`;
    return escapeHtml(s);
  });
  return `<p class="also">Also takes ${links.join(", ")}.</p>`;
}

function elementCard(e: Entry, r: string, tagged: boolean): string {
  const id = e.name;
  return `<section class="el" id="${escapeHtml(id)}"><h3><a href="#${escapeHtml(id)}">${tagged ? `<span class="tag">&lt;${escapeHtml(e.name)}&gt;</span>` : `<span class="tag">&lt;${escapeHtml(e.name)} /&gt;</span>`}</a></h3>
<p class="summary">${docInline(e.summary)}</p>${e.doc ? `<div class="doc">${docInline(e.doc)}</div>` : ""}${propsTable(e)}${sharedNote(e, r)}</section>`;
}

function referencePages() {
  // elements
  {
    const path = "reference/elements.html";
    const r = rootOf(path);
    const byName = new Map(ref.elements.map((e) => [e.name, e]));
    const toc: Heading[] = [{ level: 2, text: "Shared props", id: "shared-props" }];
    const parts: string[] = [
      `<h1>Element reference</h1>`,
      `<p class="lead">Every lowercase JSX element tscad understands, generated from the type definitions — the same text your editor shows on hover. Lengths in mm, angles in degrees.</p>`,
      `<div class="chips">${allGroups.flatMap(([, , n]) => n).map((n) => `<a href="#${n}">&lt;${n}&gt;</a>`).join("")}</div>`,
      `<h2 id="shared-props"><a class="anchor" href="#shared-props">#</a>Shared props</h2>`,
    ];
    for (const s of ref.shared) {
      const id = s.name.toLowerCase();
      parts.push(
        `<section class="el" id="${id}"><h3><a href="#${id}"><span class="tag">${s.name === "Placement" ? "Placement (3D)" : "Placement (2D)"}</span></a></h3><p class="summary">${docInline(s.doc)}</p>${propsTable({ name: s.name, summary: "", doc: "", props: s.props, shared: [] })}</section>`,
      );
    }
    for (const [title, desc, names] of allGroups) {
      const id = slugify(title);
      toc.push({ level: 2, text: title, id });
      parts.push(`<div class="ref-group"><h2 id="${id}"><a class="anchor" href="#${id}">#</a>${escapeHtml(title)}</h2><p>${escapeHtml(desc)}</p>`);
      for (const n of names) {
        const e = byName.get(n);
        if (e) parts.push(elementCard(e, r, true));
      }
      parts.push(`</div>`);
    }
    write(path, page({ path, title: "Element reference", body: parts.join("\n"), section: "reference", sidebar, toc }));
  }
  // parts library
  {
    const path = "reference/parts.html";
    const r = rootOf(path);
    const intro = renderMarkdown(
      `# Parts library

\`tscad/parts\` is a library of ordinary components built from the intrinsic elements — the
"parts are npm packages" idea. Holes and pockets are **cutting tools pointing −Z from z = 0**:
drop them into a \`<difference>\` at the top face of a part.

\`\`\`tsx
import { BoltPattern, CounterboreHole, mountPatterns } from "tscad/parts"

<difference>
  <box size={[60, 60, 6]} />
  <cylinder d={mountPatterns.nema17.pilot + 0.5} h={6} />
  <BoltPattern pattern={mountPatterns.nema17} z={6}>
    <CounterboreHole size="M3" depth={6} />
  </BoltPattern>
</difference>
\`\`\`

ISO data is exported too: \`metric.M3.clearance.normal\` (3.4 mm), \`metric.M4.tapDrill\` (3.3 mm),
\`metric.M5.socketHead\`, \`.counterbore\`, \`.countersunk\`, \`.nut\`, \`.insert\` for M2 – M12, and
\`mountPatterns\` for the Raspberry Pi 4 / Zero, Arduino Uno, NEMA 17 and NEMA 23.`,
      { highlight },
    );
    const cards = ref.components.map((c) => elementCard(c, r, false)).join("\n");
    const toc: Heading[] = ref.components.map((c) => ({ level: 2, text: c.name, id: c.name }));
    write(path, page({ path, title: "Parts library", body: `${intro.html}<div class="chips">${ref.components.map((c) => `<a href="#${c.name}">&lt;${c.name}&gt;</a>`).join("")}</div>${cards}`, section: "reference", sidebar, toc }));
  }
  // API: docs/api.md
  {
    const path = "reference/api.html";
    const src = join(DOCS, "api.md");
    const { html, headings } = md(readFileSync(src, "utf8"), src, path);
    write(path, page({ path, title: "API reference", body: html, section: "reference", sidebar, toc: headings }));
  }
}

const SAMPLE = `import { defineParams, edges, type ParamValues } from "tscad"
import { BoltPattern, CounterboreHole, mountPatterns } from "tscad/parts"

export const params = defineParams({
  thickness: { type: "number", default: 6, min: 3, max: 12, unit: "mm" },
  corner: { type: "number", default: 6, min: 0, max: 12, unit: "mm" },
})

export default function MotorMount(p: ParamValues<typeof params>) {
  const { thickness: t, corner } = p
  const motor = mountPatterns.nema17
  return (
    <part name="mount" material="petg">
      <difference>
        <fillet radius={corner} edges={edges.vertical()}>
          <box size={[60, 60, t]} />
        </fillet>
        <cylinder d={motor.pilot + 0.5} h={t} />
        <BoltPattern pattern={motor} z={t}>
          <CounterboreHole size="M3" depth={t} />
        </BoltPattern>
      </difference>
    </part>
  )
}
`;

const ICONS = {
  code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg>`,
  cube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2 21 7v10l-9 5-9-5V7Z"/><path d="M12 22V12M21 7l-9 5-9-5"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7Z"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7h18M3 12h18M3 17h18"/><path d="M8 7v10M16 7v10"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>`,
};

function landing(sampleImage: string | undefined) {
  const path = "index.html";
  const r = "./";
  const gallery = examples.filter((e) => e.image).slice(0, 6);
  const feature = (ico: string, title: string, text: string) => `<div class="feature"><div class="ico">${ico}</div><h3>${title}</h3><p>${text}</p></div>`;
  const body = `
<section class="hero">
  <div>
    <span class="eyebrow"><b>new</b> STEP · STL · 3MF · DXF · MCP for agents</span>
    <h1>CAD as <span class="grad">TSX</span>.</h1>
    <p class="lead">Write solid models as typed JSX components. tscad compiles them to an exact B-rep with a real CAD kernel in WebAssembly — parametric, versionable, and as composable as any React app.</p>
    <div class="cta">
      <a class="btn primary lg" href="docs/getting-started.html">Get started</a>
      <a class="btn lg" href="play/#example=enclosure">Open the playground →</a>
    </div>
    <code class="install"><span>$</span> bunx tscad init my-part</code>
  </div>
  <div class="hero-art">
    <div class="frame"><div class="bar"><i></i><i></i><i></i><span>enclosure.tsx</span></div><img src="images/enclosure.png" alt="A parametric electronics enclosure rendered by tscad" width="1200" height="800" /></div>
  </div>
</section>

<section class="section">
  <h2>Parts are components.</h2>
  <p class="lead">Parameters are typed props, holes are components from <code>tscad/parts</code>, and edges are picked by what they are — not by fragile indices.</p>
  <div class="split">
    <pre class="code" data-lang="tsx"><code>${highlight(SAMPLE.trimEnd(), "tsx")}</code></pre>
    <div class="frame">
      <div class="bar"><i></i><i></i><i></i><span>motor-mount.tsx</span></div>
      ${sampleImage ? `<img src="${sampleImage}" alt="The motor mount rendered" loading="lazy" />` : `<img src="images/parts-showcase.png" alt="Parts showcase" loading="lazy" />`}
      <div class="caption"><span>NEMA 17 mount · counterbored M3 · 2 params</span><a class="btn" href="${playLink(r, { source: SAMPLE })}">Edit in playground →</a></div>
    </div>
  </div>
</section>

<section class="section">
  <h2>Everything a part needs.</h2>
  <p class="lead">A real modelling toolkit with friendly defaults: lengths in millimetres, Z up, boxes sitting on the build plate.</p>
  <div class="features">
    ${feature(ICONS.cube, "Exact B-rep kernel", "solidcore runs in WebAssembly: booleans, fillets, chamfers, shells, revolves, lofts and sweeps on exact geometry — and true STEP export.")}
    ${feature(ICONS.code, "Just TypeScript", "Components, <code>.map</code>, conditionals, npm packages. Every element and prop is typed and documented in your editor.")}
    ${feature(ICONS.sliders, "Parametric by default", "<code>defineParams</code> gives typed props and live sliders; the kernel caches unchanged subtrees, so tweaks rebuild fast.")}
    ${feature(ICONS.box, "Sketches that make sense", "Draw 2D shapes — nested loops become holes. Text, SVG paths, offsets and constraint-solved sketches.")}
    ${feature(ICONS.bolt, "Instant feedback", "<code>tscad dev</code> hot-reloads a viewer; errors point at your TSX line; click an edge to get its selector.")}
    ${feature(ICONS.spark, "Built for agents", "<code>tscad mcp</code> lets Claude write, evaluate, render and export models — the reference is generated from the types.")}
  </div>
</section>

<section class="section">
  <h2>Gallery</h2>
  <p class="lead">Complete parametric models — open any of them in the playground.</p>
  <div class="gallery">${gallery.map((e) => galleryCard(e, r)).join("")}</div>
  <p style="margin-top:22px"><a class="btn" href="gallery/index.html">All examples →</a></p>
</section>

<section class="section">
  <div class="mcp">
    <div>
      <h2>Design with Claude.</h2>
      <p class="lead">tscad ships an MCP server. Add it to Claude Code and ask for a part: it reads the reference, writes the TSX, evaluates it with the kernel, looks at the render, fixes what fails, and exports STEP.</p>
      <p><a href="docs/mcp.html">MCP server docs →</a></p>
    </div>
    <pre class="code" data-lang="sh"><code>${highlight("claude mcp add tscad -- bunx tscad mcp", "sh")}</code></pre>
  </div>
</section>`;
  write(path, page({ path, title: "tscad — CAD as TSX", body, section: "home", wide: true }));
}

function galleryCard(e: (typeof examples)[number], r: string): string {
  return `<div class="card">${e.image ? `<a href="${r}gallery/${e.name}.html"><img src="${r}${e.image}" alt="${escapeHtml(e.title)}" loading="lazy" /></a>` : ""}<div class="body"><h3><a href="${r}gallery/${e.name}.html">${escapeHtml(e.title)}</a></h3><p>${inline(e.summary, { opts: {} })}</p><div class="links"><a href="${playLink(r, e)}">Playground →</a><a href="${r}gallery/${e.name}.html">Source</a></div></div></div>`;
}

function galleryPages() {
  {
    const path = "gallery/index.html";
    const r = rootOf(path);
    const body = `<h1>Gallery</h1><p class="lead">Every example model in the repository, rendered by tscad's headless renderer. Each opens in the playground with its parameters.</p><div class="gallery">${examples.map((e) => galleryCard(e, r)).join("")}</div>`;
    write(path, page({ path, title: "Gallery", body, section: "gallery", sidebar }));
  }
  for (const e of examples) {
    const path = `gallery/${e.name}.html`;
    const r = rootOf(path);
    const body = `<h1>${escapeHtml(e.title)}</h1>
<div class="example-head">${e.image ? `<img src="${r}${e.image}" alt="${escapeHtml(e.title)}" />` : "<div></div>"}<div><p class="lead">${inline(e.summary, { opts: {} })}</p><p><a class="btn primary" href="${playLink(r, e)}">Open in playground →</a></p><p><a href="${REPO}/blob/main/examples/${e.name}.tsx" rel="noopener">examples/${e.name}.tsx on GitHub</a></p><pre class="code" data-lang="sh"><code>${highlight(`bunx tscad dev examples/${e.name}.tsx`, "sh")}</code></pre></div></div>
<pre class="code" data-lang="tsx"><code>${highlight(e.source.trimEnd(), "tsx")}</code></pre>`;
    write(path, page({ path, title: e.title, description: e.summary, body, section: "gallery", sidebar }));
  }
}

// ---------------------------------------------------------------------------------------------
// assets, sample render, playground

function assets() {
  const viewerCss = readFileSync(join(ROOT, "src/viewer/styles.css"), "utf8");
  // the colour tokens: every top-level :root block, in order
  const tokens = [...viewerCss.matchAll(/^:root[^{]*\{[^}]*\}/gm)].map((m) => m[0]).join("\n\n");
  mkdirSync(join(OUT, "assets"), { recursive: true });
  writeFileSync(join(OUT, "assets/style.css"), `/* tokens from src/viewer/styles.css */\n${tokens}\n\n${readFileSync(join(ROOT, "site/style.css"), "utf8")}`);
  writeFileSync(join(OUT, "assets/site.js"), readFileSync(join(ROOT, "site/site.js"), "utf8"));
  if (existsSync(join(DOCS, "images"))) cpSync(join(DOCS, "images"), join(OUT, "images"), { recursive: true });
  writeFileSync(join(OUT, ".nojekyll"), "");
}

/** Render the landing sample with the kernel (also proves it compiles). */
async function renderSample(): Promise<string | undefined> {
  if (!RENDER) return undefined;
  try {
    const { runModel } = await import("../src/cli/model");
    const { renderPNG } = await import("../src/render");
    const tmp = join(ROOT, "site", `.sample-${process.pid}.tsx`);
    writeFileSync(tmp, SAMPLE);
    try {
      const run = await runModel(tmp, {});
      if (!run.result.ok) throw new Error(JSON.stringify(run.result.parts.map((p) => p.error)));
      const parts = [];
      for (const p of run.result.parts) {
        const mesh = await run.kernel.mesh(p.name);
        const color = run.rendered.document.parts?.find((d) => d.name === p.name)?.color;
        if (mesh) parts.push({ name: p.name, color, mesh });
      }
      const png = renderPNG(parts as any, { width: 1000, height: 820, view: "iso", background: "transparent", margin: 0.18 } as any);
      mkdirSync(join(OUT, "images"), { recursive: true });
      writeFileSync(join(OUT, "images/sample-motor-mount.png"), png);
      return "images/sample-motor-mount.png";
    } finally {
      rmSync(tmp, { force: true });
    }
  } catch (e) {
    console.warn(`! landing sample not rendered: ${(e as Error).message}`);
    return undefined;
  }
}

function playground() {
  const src = join(ROOT, "dist/playground");
  if (!existsSync(join(src, "index.html"))) {
    console.warn("! dist/playground not found — build it first (bun scripts/build-playground.ts); play/ links will 404");
    return;
  }
  cpSync(src, join(OUT, "play"), { recursive: true });
}

/** Every relative href/src in the written pages must exist. */
function checkLinks(): string[] {
  const broken: string[] = [];
  for (const p of written) {
    const html = readFileSync(join(OUT, p), "utf8");
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const u = m[1]!.replace(/&amp;/g, "&");
      if (/^([a-z]+:|#|data:)/i.test(u)) continue;
      const [file, hash] = u.split("#");
      if (file!.startsWith("play/") || /(^|\/)play\/$/.test(file!) || /\/play\//.test(file!)) continue;
      const target = resolve(dirname(join(OUT, p)), file || p.split("/").pop()!);
      if (!existsSync(target)) {
        broken.push(`${p}: ${u}`);
        continue;
      }
      if (hash && target.endsWith(".html")) {
        const t = readFileSync(target, "utf8");
        if (!t.includes(`id="${hash}"`)) broken.push(`${p}: ${u} (no #${hash})`);
      }
    }
  }
  return broken;
}

// ---------------------------------------------------------------------------------------------

export async function buildSite(opts: { out?: string; render?: boolean; quiet?: boolean } = {}): Promise<{ out: string; pages: string[]; broken: string[] }> {
  const t0 = performance.now();
  if (opts.out) OUT = resolve(opts.out);
  if (opts.render !== undefined) RENDER = opts.render;
  written.clear();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  assets();
  const sample = await renderSample();
  landing(sample);
  docPagesOut();
  referencePages();
  galleryPages();
  playground();
  const broken = checkLinks();
  if (!opts.quiet) console.log(`✓ ${OUT} in ${(performance.now() - t0).toFixed(0)} ms — ${written.size} pages, ${examples.length} examples, ${ref.elements.length} elements`);
  for (const b of broken) console.warn(`! broken link ${b}`);
  return { out: OUT, pages: [...written], broken };
}

if (import.meta.main) {
  const { broken } = await buildSite();
  const port = flag("--serve");
  if (port !== undefined) {
    const server = Bun.serve({
      port: Number(port) || 4700,
      fetch(req) {
        let p = decodeURIComponent(new URL(req.url).pathname);
        if (p.endsWith("/")) p += "index.html";
        const f = Bun.file(join(OUT, p));
        return f.size ? new Response(f) : new Response("not found", { status: 404 });
      },
    });
    console.log(`  serving http://localhost:${server.port}/`);
  } else if (broken.length) process.exitCode = 1;
}
