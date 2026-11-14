/** Page shell: header, sidebar, table of contents, footer. All URLs are relative. */
import { escapeHtml, type Heading } from "./md";

export const REPO = "https://github.com/bherbruck/tscad";

export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 28 10 16 17 4 10Z" fill="#b7c6ff"/><path d="M4 10 16 17V30L4 23Z" fill="#7391ff"/><path d="M28 10 16 17V30L28 23Z" fill="#4a5fd8"/></svg>`;
const SUN = `<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON = `<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`;
const GH = `<svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.5 18.3 4.8 18.3 4.8c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5Z"/></svg>`;
const MENU = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;

export interface NavItem {
  title: string;
  href: string; // relative to the site root
  sub?: NavItem[];
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface PageOptions {
  /** Path of this page relative to the site root, e.g. "docs/guide.html". */
  path: string;
  title: string;
  description?: string;
  body: string;
  /** Top-nav section to highlight. */
  section?: "docs" | "reference" | "gallery" | "home";
  sidebar?: NavGroup[];
  toc?: Heading[];
  /** Full-width page (landing). */
  wide?: boolean;
}

/** Relative prefix from `path` back to the site root. */
/** The canonical origin (GitHub Pages custom domain); internal links stay relative. */
export const SITE = "https://tscad.io/";

export function rootOf(path: string): string {
  const depth = path.split("/").length - 1;
  return depth ? "../".repeat(depth) : "./";
}

export function page(o: PageOptions): string {
  const r = rootOf(o.path);
  const u = (href: string) => (/^(https?:|#|mailto:)/.test(href) ? href : r + href);
  const navLink = (key: PageOptions["section"], href: string, label: string) => `<a href="${u(href)}"${o.section === key ? ' class="active"' : ""}>${label}</a>`;
  const header = `<header class="top">
  <a class="brand" href="${u("index.html")}">${LOGO}<span>tscad</span></a>
  <nav>
    ${navLink("docs", "docs/getting-started.html", "Docs")}
    ${navLink("reference", "reference/elements.html", "Reference")}
    ${navLink("gallery", "gallery/index.html", "Gallery")}
    <a href="${u("play/")}">Playground</a>
  </nav>
  <span class="spacer"></span>
  <a class="btn" href="${REPO}" rel="noopener" aria-label="GitHub">${GH}<span class="gh-label">GitHub</span></a>
  <button class="icon-btn" type="button" data-theme-toggle aria-label="Toggle theme">${SUN}${MOON}</button>
  <button class="icon-btn menu-btn" type="button" aria-label="Menu">${MENU}</button>
</header>`;
  const sidebar = o.sidebar
    ? `<aside class="sidebar"><details open><summary>Menu</summary>${o.sidebar
        .map(
          (g) =>
            `<h4>${escapeHtml(g.title)}</h4>${g.items
              .map(
                (it) =>
                  `<a href="${u(it.href)}"${it.href === o.path ? ' class="active"' : ""}>${escapeHtml(it.title)}</a>${
                    it.href === o.path && it.sub ? it.sub.map((s) => `<a class="sub" href="${u(s.href)}">${escapeHtml(s.title)}</a>`).join("") : ""
                  }`,
              )
              .join("")}`,
        )
        .join("")}</details></aside>`
    : "";
  const tocItems = (o.toc ?? []).filter((h) => h.level === 2 || h.level === 3);
  const toc = tocItems.length > 2 ? `<nav class="toc" aria-label="On this page"><h4>On this page</h4>${tocItems.map((h) => `<a class="l${h.level}" href="#${h.id}">${escapeHtml(h.text)}</a>`).join("")}</nav>` : "";
  const main = o.wide
    ? `<main>${o.body}</main>`
    : `<div class="layout${toc ? "" : " no-toc"}">${sidebar}<main class="prose">${o.body}</main>${toc}</div>`;
  const title = o.section === "home" ? o.title : `${o.title} · tscad`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(o.description ?? "tscad — parametric CAD as TSX. Write solid models as JSX components, get exact B-rep STEP, STL and 3MF.")}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:image" content="${SITE}images/pi5-case-auto.png" />
<meta property="og:url" content="${SITE}${o.path.replace(/(^|\/)index\.html$/, "$1")}" />
<link rel="canonical" href="${SITE}${o.path.replace(/(^|\/)index\.html$/, "$1")}" />
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO.replace('aria-hidden="true"', 'xmlns="http://www.w3.org/2000/svg"'))}" />
<script>try{var t=new URLSearchParams(location.search).get("theme")||localStorage.getItem("tscad.theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="${u("assets/style.css")}" />
</head>
<body>
${header}
${main}
<footer><span>tscad — CAD as TSX · MIT / Apache-2.0</span><span><a href="${u("docs/getting-started.html")}">Docs</a> · <a href="${u("reference/elements.html")}">Reference</a> · <a href="${u("play/")}">Playground</a> · <a href="${REPO}" rel="noopener">GitHub</a></span></footer>
<script src="${u("assets/site.js")}" defer></script>
</body>
</html>
`;
}
