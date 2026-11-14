import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { highlight } from "../site/highlight";
import { renderMarkdown, slugify } from "../site/md";
import { buildSite } from "../scripts/build-docs";
import { referenceEntries } from "../src/mcp/reference";

describe("markdown", () => {
  test("blocks", () => {
    const { html, headings, title } = renderMarkdown(
      "# Title\n\nSome *em* and **strong** and `code <x>`.\n\n## 1. Set up\n\n- a\n- b\n  - nested\n\n1. one\n2. two\n\n> quote\n\n---\n\n| a | b |\n|---|--:|\n| `x \\| y` | 2 |\n",
    );
    expect(title).toBe("Title");
    expect(headings.map((h) => h.id)).toEqual(["title", "1-set-up"]);
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain("<code>code &lt;x&gt;</code>");
    expect(html).toMatch(/<ul><li>a<\/li><li>b\s*<ul><li>nested<\/li><\/ul><\/li><\/ul>/);
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(html).toContain("<blockquote><p>quote</p></blockquote>");
    expect(html).toContain("<hr />");
    expect(html).toContain('<td><code>x | y</code></td><td style="text-align:right">2</td>');
  });
  test("code, links, images, escaping", () => {
    const { html } = renderMarkdown('```tsx\n<box size={1} />\n```\n\nSee [the guide](guide.md#x) and ![img](images/a.png "t"). <b>raw</b> <https://x.dev>', {
      highlight: (c, l) => `[${l}]${c}`,
      url: (u, k) => `${k}:${u}`,
    });
    expect(html).toContain('<pre class="code" data-lang="tsx"><code>[tsx]<box size={1} /></code></pre>');
    expect(html).toContain('<a href="link:guide.md#x">the guide</a>');
    expect(html).toContain('<img src="image:images/a.png" alt="img" loading="lazy" title="t" />');
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
    expect(html).toContain('<a href="https://x.dev" rel="noopener">https://x.dev</a>');
  });
  test("slugs match GitHub", () => {
    expect(slugify("10. Revolve, shell, loft and sweep")).toBe("10-revolve-shell-loft-and-sweep");
    expect(slugify("Sketch → solid")).toBe("sketch--solid");
  });
  test("highlighting", () => {
    expect(highlight('<box size={[1, 2]} />', "tsx")).toContain('<span class="tok-typeName">box</span>');
    expect(highlight("const a = 1", "ts")).toContain('<span class="tok-keyword">const</span>');
    expect(highlight("bunx tscad dev --open", "sh")).toContain('<span class="tok-propertyName">--open</span>');
    expect(highlight("<b>", "text")).toBe("&lt;b&gt;");
  });
});

describe("site build", () => {
  test("every page builds, no broken links, reference covers every element", async () => {
    const out = mkdtempSync(join(tmpdir(), "tscad-site-"));
    try {
      const { pages, broken } = await buildSite({ out, render: false, quiet: true });
      expect(broken).toEqual([]);
      for (const p of ["index.html", "docs/getting-started.html", "docs/guide.html", "docs/mcp.html", "docs/selectors.html", "docs/kernel.html", "reference/elements.html", "reference/parts.html", "reference/api.html", "gallery/index.html", "gallery/bracket.html", "docs/index.html", "reference/index.html", "404.html"]) {
        expect(pages).toContain(p);
      }
      expect(existsSync(join(out, "assets/style.css"))).toBe(true);
      expect(readFileSync(join(out, "assets/style.css"), "utf8")).toContain("--accent:");
      expect(existsSync(join(out, "images/enclosure.png"))).toBe(true);
      const elements = readFileSync(join(out, "reference/elements.html"), "utf8");
      for (const e of referenceEntries().elements) expect(elements).toContain(`id="${e.name}"`);
      const partsPage = readFileSync(join(out, "reference/parts.html"), "utf8");
      expect(partsPage).toContain('id="CounterboreHole"');
      // playground links: an example by name and the landing sample by encoded source
      const index = readFileSync(join(out, "index.html"), "utf8");
      expect(index).toContain("play/#example=pi5-case-auto");
      expect(index).toMatch(/play\/#code=[\w-]+/);
      // relative URLs only (works under a GitHub Pages project path)
      expect(index).not.toMatch(/(href|src)="\/(?!\/)/);
      // the 404 page is served at any depth: root-absolute links only
      const notFound = readFileSync(join(out, "404.html"), "utf8");
      expect(notFound).toContain('href="/assets/style.css"');
      expect(notFound).not.toMatch(/(href|src)="\.\.?\//);
      // house style: no em dashes in any page (titles, meta, prose, generated reference)
      const dashed = pages.filter((p) => p.endsWith(".html") && readFileSync(join(out, p), "utf8").includes("\u2014"));
      expect(dashed).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
