/**
 * A small CommonMark-ish markdown renderer for the docs site: headings (with GitHub-style
 * slugs), paragraphs, fenced code (highlighted by a hook), nested lists, blockquotes, GFM
 * tables, rules, and inline code / emphasis / links / images / autolinks. Raw HTML is escaped.
 */

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface MdOptions {
  /** Highlight a fenced block; return HTML (already escaped). */
  highlight?: (code: string, lang: string) => string;
  /** Rewrite link/image URLs (e.g. `.md` → `.html`). */
  url?: (href: string, kind: "link" | "image") => string;
}

export interface MdResult {
  html: string;
  headings: Heading[];
  /** The first `# h1`, if any. */
  title?: string;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub's heading slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

export function renderMarkdown(src: string, opts: MdOptions = {}): MdResult {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const ctx = { opts, headings, used };
  const html = blocks(src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"), ctx);
  const h1 = headings.find((h) => h.level === 1);
  return { html, headings, ...(h1 ? { title: h1.text } : {}) };
}

type Ctx = { opts: MdOptions; headings: Heading[]; used: Map<string, number> };

const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/;

function blocks(lines: string[], ctx: Ctx): string {
  const out: string[] = [];
  let i = 0;
  const isBlank = (l: string | undefined) => l === undefined || l.trim() === "";
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }
    // fenced code
    const fence = line.match(/^( {0,3})(`{3,}|~{3,})\s*([\w+-]*)?.*$/);
    if (fence) {
      const [, ind, marker, lang = ""] = fence;
      const body: string[] = [];
      i++;
      const strip = new RegExp(`^ {0,${ind!.length}}`);
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker!)) body.push(lines[i++]!.replace(strip, ""));
      i++;
      const code = body.join("\n");
      const inner = ctx.opts.highlight ? ctx.opts.highlight(code, lang) : escapeHtml(code);
      out.push(`<pre class="code" data-lang="${escapeHtml(lang)}"><code>${inner}</code></pre>`);
      continue;
    }
    // heading
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1]!.length;
      const raw = h[2]!;
      const text = stripInline(raw);
      let id = slugify(text);
      const n = ctx.used.get(id) ?? 0;
      ctx.used.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      ctx.headings.push({ level, text, id });
      out.push(`<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inline(raw, ctx)}</h${level}>`);
      i++;
      continue;
    }
    // rule
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }
    // blockquote
    if (/^ {0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i]) && (/^ {0,3}>/.test(lines[i]!) || body.length)) {
        if (!/^ {0,3}>/.test(lines[i]!) && (LIST.test(lines[i]!) || /^#/.test(lines[i]!))) break;
        body.push(lines[i++]!.replace(/^ {0,3}> ?/, ""));
      }
      out.push(`<blockquote>${blocks(body, ctx)}</blockquote>`);
      continue;
    }
    // table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]!)) {
      const cells = (l: string) => {
        const t = l.trim().replace(/^\|/, "").replace(/\|$/, "");
        const parts: string[] = [];
        let cur = "", code = false;
        for (let k = 0; k < t.length; k++) {
          const ch = t[k]!;
          if (ch === "`") code = !code;
          if (ch === "\\" && t[k + 1] === "|") {
            cur += "|";
            k++;
            continue;
          }
          if (ch === "|" && !code) {
            parts.push(cur.trim());
            cur = "";
          } else cur += ch;
        }
        parts.push(cur.trim());
        return parts;
      };
      const head = cells(line);
      const align = cells(lines[i + 1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i]!.includes("|")) rows.push(cells(lines[i++]!));
      const td = (tag: string, c: string, k: number) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${inline(c, ctx)}</${tag}>`;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c, k) => td("th", c, k)).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, k) => td("td", r[k] ?? "", k)).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    // list
    const lm = line.match(LIST);
    if (lm) {
      const ordered = /\d/.test(lm[2]!);
      const start = ordered ? parseInt(lm[2]!, 10) : 1;
      const items: string[][] = [];
      let loose = false;
      while (i < lines.length) {
        const m = lines[i]!.match(LIST);
        if (!m || /\d/.test(m[2]!) !== ordered) break;
        const indent = m[0].length === m[1]!.length + m[2]!.length ? m[1]!.length + m[2]!.length + 1 : m[0].length;
        const item = [lines[i]!.slice(m[0].length)];
        i++;
        while (i < lines.length) {
          const l = lines[i]!;
          if (isBlank(l)) {
            // a blank line continues the item only if the next line is indented
            let j = i;
            while (j < lines.length && isBlank(lines[j])) j++;
            if (j < lines.length && lines[j]!.length - lines[j]!.trimStart().length >= indent) {
              for (; i < j; i++) item.push("");
              loose = loose || !LIST.test(lines[j]!.slice(indent));
              continue;
            }
            if (j < lines.length && lines[j]!.match(LIST) && /\d/.test(lines[j]!.match(LIST)![2]!) === ordered && (lines[j]!.length - lines[j]!.trimStart().length) < indent) loose = true;
            break;
          }
          const ind = l.length - l.trimStart().length;
          if (ind >= indent) item.push(l.slice(indent));
          else if (!LIST.test(l) && !/^ {0,3}(#|```|>)/.test(l) && item[item.length - 1]!.trim() !== "") item.push(l.trimStart()); // lazy continuation
          else break;
          i++;
        }
        items.push(item);
        while (i < lines.length && isBlank(lines[i]) && lines[i + 1] && LIST.test(lines[i + 1]!) && /\d/.test(lines[i + 1]!.match(LIST)![2]!) === ordered) {
          i++;
          loose = true;
        }
      }
      const tag = ordered ? "ol" : "ul";
      const lis = items.map((it) => {
        const inner = blocks(it, ctx);
        const tight = !loose && /^<p>[\s\S]*?<\/p>/.test(inner) ? inner.replace(/^<p>([\s\S]*?)<\/p>/, "$1") : inner;
        return `<li>${tight}</li>`;
      });
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${lis.join("")}</${tag}>`);
      continue;
    }
    // paragraph
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i])) {
      const l = lines[i]!;
      if (para.length && (/^ {0,3}(#{1,6}\s|```|~~~|>)/.test(l) || LIST.test(l) || /^ {0,3}([-*_])( *\1){2,} *$/.test(l))) break;
      para.push(l);
      i++;
    }
    out.push(`<p>${inline(para.join("\n").trim(), ctx)}</p>`);
  }
  return out.join("\n");
}

function stripInline(s: string): string {
  return s.replace(/`([^`]*)`/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");
}

/** Inline markup → HTML. */
export function inline(src: string, ctx: Ctx | { opts: MdOptions }): string {
  let out = "";
  let i = 0;
  const url = (u: string, kind: "link" | "image") => (ctx.opts.url ? ctx.opts.url(u, kind) : u);
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|<>~]/.test(src[i + 1]!)) {
      out += escapeHtml(src[i + 1]!);
      i += 2;
      continue;
    }
    if (ch === "`") {
      const m = src.slice(i).match(/^(`+)([\s\S]*?[^`])\1(?!`)/);
      if (m) {
        out += `<code>${escapeHtml(m[2]!.replace(/^ (.*) $/, "$1"))}</code>`;
        i += m[0].length;
        continue;
      }
    }
    if (ch === "!" || ch === "[") {
      const m = src.slice(i).match(/^(!?)\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)/);
      if (m) {
        const [all, bang, text, href, title] = m;
        if (bang) out += `<img src="${escapeHtml(url(href!, "image"))}" alt="${escapeHtml(stripInline(text!))}" loading="lazy"${title ? ` title="${escapeHtml(title)}"` : ""} />`;
        else {
          const u = url(href!, "link");
          const ext = /^https?:/.test(u);
          out += `<a href="${escapeHtml(u)}"${ext ? ' rel="noopener"' : ""}>${inline(text!, ctx)}</a>`;
        }
        i += all!.length;
        continue;
      }
    }
    if (ch === "<") {
      const m = src.slice(i).match(/^<(https?:\/\/[^\s>]+)>/);
      if (m) {
        out += `<a href="${escapeHtml(m[1]!)}" rel="noopener">${escapeHtml(m[1]!)}</a>`;
        i += m[0].length;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const m = src.slice(i).match(/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/) ?? src.slice(i).match(/^(\*|_)(?=\S)([\s\S]*?\S)\1(?![*_\w])/);
      const before = src[i - 1];
      if (m && !(ch === "_" && before && /\w/.test(before))) {
        const tag = m[1]!.length === 2 ? "strong" : "em";
        out += `<${tag}>${inline(m[2]!, ctx)}</${tag}>`;
        i += m[0].length;
        continue;
      }
    }
    if (ch === "\n") {
      out += /  $/.test(src.slice(0, i)) ? "<br />\n" : "\n";
      i++;
      continue;
    }
    out += escapeHtml(ch);
    i++;
  }
  return out.replace(/ +(<br \/>)/g, "$1");
}
