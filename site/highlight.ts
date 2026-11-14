/** Build-time syntax highlighting: lezer for TS/TSX/JS/JSON, a tiny tokenizer for shell. */
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { parser } from "@lezer/javascript";
import { escapeHtml } from "./md";

const tsx = parser.configure({ dialect: "jsx ts" });
const js = parser.configure({ dialect: "jsx" });

export function highlight(code: string, lang: string): string {
  const l = lang.toLowerCase();
  if (["ts", "tsx", "typescript", "js", "jsx", "javascript", "json", "jsonc", ""].includes(l) && (l || looksLikeCode(code))) {
    const tree = (l === "js" || l === "jsx" || l === "javascript" ? js : tsx).parse(code);
    let out = "";
    let pos = 0;
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      if (from > pos) out += escapeHtml(code.slice(pos, from));
      out += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
      pos = to;
    });
    return out + escapeHtml(code.slice(pos));
  }
  if (["sh", "bash", "shell", "console", "zsh"].includes(l)) return shell(code);
  return escapeHtml(code);
}

function looksLikeCode(code: string): boolean {
  return /^(import|export|const|function|<\w)/m.test(code);
}

function shell(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return `<span class="tok-comment">${escapeHtml(line)}</span>`;
      const m = line.match(/^(\s*\$?\s*)(\S+)(.*)$/);
      if (!m) return escapeHtml(line);
      const rest = escapeHtml(m[3]!)
        .replace(/(\s)(--?[\w-]+)/g, '$1<span class="tok-propertyName">$2</span>')
        .replace(/(&quot;[^&]*&quot;|'[^']*')/g, '<span class="tok-string">$1</span>')
        .replace(/(\s)(#.*)$/, '$1<span class="tok-comment">$2</span>');
      return `${escapeHtml(m[1]!)}<span class="tok-keyword">${escapeHtml(m[2]!)}</span>${rest}`;
    })
    .join("\n");
}
