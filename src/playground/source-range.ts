/** Source ranges of JSX in the playground editor (pure; no DOM). */

/** The [from, to) range of the opening tag at `start` and of a `name={...}` / `name="..."` prop in it. */
export function tagRange(text: string, start: number, props: string[] = []): { from: number; to: number } | undefined {
  if (text[start] !== "<") {
    const lt = text.lastIndexOf("<", start);
    if (lt < 0 || start - lt > 200) return undefined;
    start = lt;
  }
  // Scan to the end of the opening tag, skipping {...} and strings.
  let i = start + 1, depth = 0;
  let quote = "";
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) break;
  }
  const tag = { from: start, to: Math.min(i + 1, text.length) };
  const open = text.slice(tag.from, tag.to);
  for (const name of props) {
    const m = new RegExp(`\\s(${name})(?:=)`).exec(open);
    if (!m) continue;
    const from = tag.from + m.index + 1;
    let j = from + m[1]!.length + 1;
    if (open[j - tag.from] === "{") {
      let d = 0;
      for (; j < tag.to; j++) {
        if (text[j] === "{") d++;
        else if (text[j] === "}" && --d === 0) break;
      }
      return { from, to: j + 1 };
    }
    const q = text[j];
    if (q === '"' || q === "'") return { from, to: text.indexOf(q, j + 1) + 1 };
    return { from, to: from + m[1]!.length };
  }
  return tag;
}
