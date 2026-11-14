/** Number, size and source formatting for the viewer UI. */
import { escapeHtml } from "../dom";
import { fmtArea, fmtBytes, fmtMass, fmtMs, fmtNum, fmtVol } from "../fmt";

export { fmtArea, fmtBytes, fmtMass, fmtMs, fmtNum, fmtVol };

/** Any CSS colour as `#rrggbb` (for colour inputs). */
export function toHexColor(c: string): string {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = c;
  const v = ctx.fillStyle;
  return v.startsWith("#") ? v : "#888888";
}
/** A file URL or path shortened for display. */
export function shortFile(f: string) {
  return f.replace(/^.*?:\/\/[^/]+/, "").replace(/^\.?\//, "");
}
/** A light TSX highlighter for code frames. */
export function highlightTsx(src: string): string {
  const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[a-zA-Z][\w.]*)|\b(const|let|var|function|return|export|default|import|from|if|else|for|of|in|new|type|interface)\b|\b(\d+(?:\.\d+)?)\b/g;
  let out = "", last = 0;
  for (const m of src.matchAll(re)) {
    out += escapeHtml(src.slice(last, m.index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "t" : m[4] ? "k" : "n";
    out += `<span class="tk-${cls}">${escapeHtml(m[0])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + escapeHtml(src.slice(last));
}
