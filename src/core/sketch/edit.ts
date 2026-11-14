/**
 * Minimal source edits for interactive editing: find a JSX element by its source location and
 * replace (or insert) one numeric prop. Pure text functions (no TypeScript parser) that
 * refuse anything that isn't a plain number literal.
 */
import type { SourceLoc } from "../errors";

/** Replace `source.slice(start, end)` with `text`. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export type EditResult =
  | { ok: true; edits: TextEdit[]; source: string }
  | { ok: false; reason: string; /** The prop's expression when it isn't a literal. */ expression?: string };

interface Attr {
  name: string;
  /** Value span (the text between the braces / quotes), when it has one. */
  value?: { start: number; end: number; text: string; kind: "expr" | "string" };
}

interface OpenTag {
  start: number;
  /** Where `/>` or `>` begins. */
  close: number;
  tag: string;
  attrs: Attr[];
}

/** A number as source text: at most 4 decimals, no trailing zeros, no "-0". */
export function formatNumber(v: number): string {
  const r = Number(v.toFixed(4));
  return String(Object.is(r, -0) ? 0 : r);
}

function offsetOf(source: string, loc: SourceLoc): number {
  let line = 1, i = 0;
  while (line < loc.line && i < source.length) {
    const n = source.indexOf("\n", i);
    if (n < 0) return -1;
    i = n + 1;
    line++;
  }
  return i + Math.max(0, loc.column - 1);
}

/** Skip a balanced `{...}` (strings and template literals included) starting at `i` ("{"). */
function skipBraces(s: string, i: number): number {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < s.length && s[i] !== q; i++) if (s[i] === "\\") i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** The opening tag of the element written at `loc` (its `<`, or the tag name on that line). */
export function openTag(source: string, loc: SourceLoc): OpenTag | undefined {
  let i = offsetOf(source, loc);
  if (i < 0) return undefined;
  if (source[i] !== "<") {
    // be lenient: the first `<tag` on that line at or after the column
    const lineEnd = source.indexOf("\n", i);
    const re = new RegExp(`<${loc.tag ?? "[A-Za-z]"}`, "g");
    re.lastIndex = i;
    const m = re.exec(source);
    if (!m || (lineEnd >= 0 && m.index > lineEnd)) return undefined;
    i = m.index;
  }
  const m = /^<([A-Za-z][\w.:-]*)/.exec(source.slice(i));
  if (!m) return undefined;
  const tag = m[1]!;
  if (loc.tag && tag !== loc.tag) return undefined;
  let j = i + m[0].length;
  const attrs: Attr[] = [];
  for (;;) {
    while (j < source.length && /\s/.test(source[j]!)) j++;
    if (source.startsWith("/>", j) || source[j] === ">") return { start: i, close: j, tag, attrs };
    if (source[j] === "{") {
      // a spread {...props}
      const e = skipBraces(source, j);
      if (e < 0) return undefined;
      j = e + 1;
      continue;
    }
    const n = /^[\w$:-]+/.exec(source.slice(j));
    if (!n) return undefined;
    const name = n[0];
    j += name.length;
    while (/\s/.test(source[j] ?? "")) j++;
    if (source[j] !== "=") {
      attrs.push({ name });
      continue;
    }
    j++;
    while (/\s/.test(source[j] ?? "")) j++;
    if (source[j] === "{") {
      const e = skipBraces(source, j);
      if (e < 0) return undefined;
      attrs.push({ name, value: { start: j + 1, end: e, text: source.slice(j + 1, e), kind: "expr" } });
      j = e + 1;
    } else if (source[j] === '"' || source[j] === "'") {
      const q = source[j]!;
      const e = source.indexOf(q, j + 1);
      if (e < 0) return undefined;
      attrs.push({ name, value: { start: j + 1, end: e, text: source.slice(j + 1, e), kind: "string" } });
      j = e + 1;
    } else return undefined;
  }
}

const NUMBER = /^\s*-?\s*(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;

function apply(source: string, edits: TextEdit[]): string {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * Set numeric prop `prop` of the element at `loc` to `value`: replace a number literal, or insert
 * the prop when it is absent. Expressions (`length={p.width}`) are refused with the expression.
 */
export function editProp(source: string, loc: SourceLoc, prop: string, value: number): EditResult {
  const t = openTag(source, loc);
  if (!t) return { ok: false, reason: `no <${loc.tag ?? "element"}> at line ${loc.line}:${loc.column}` };
  const a = t.attrs.find((x) => x.name === prop);
  const text = formatNumber(value);
  let edit: TextEdit;
  if (!a) edit = { start: t.close, end: t.close, text: `${source[t.close - 1] === " " ? "" : " "}${prop}={${text}}${source.startsWith("/>", t.close) ? " " : ""}` };
  else if (!a.value) return { ok: false, reason: `${prop} is a boolean prop` };
  else if (a.value.kind === "expr" && NUMBER.test(a.value.text)) edit = { start: a.value.start, end: a.value.end, text };
  else if (a.value.kind === "string" && NUMBER.test(a.value.text)) edit = { start: a.value.start - 1, end: a.value.end + 1, text: `{${text}}` };
  else return { ok: false, reason: `${prop} is set by an expression, not a number`, expression: a.value.text.trim() };
  return { ok: true, edits: [edit], source: apply(source, [edit]) };
}

/** Several prop edits on one element (all or nothing). */
export function editProps(source: string, loc: SourceLoc, values: Record<string, number>): EditResult {
  let cur = source;
  const edits: TextEdit[] = [];
  for (const [prop, v] of Object.entries(values)) {
    const r = editProp(cur, loc, prop, v);
    if (!r.ok) return r;
    edits.push(...r.edits);
    cur = r.source;
  }
  return { ok: true, edits, source: cur };
}

/** Insert a child element right after the opening tag of the element at `parent`, indented. */
export function insertChild(source: string, parent: SourceLoc, element: string): EditResult {
  const t = openTag(source, parent);
  if (!t) return { ok: false, reason: `no <${parent.tag ?? "element"}> at line ${parent.line}:${parent.column}` };
  if (source.startsWith("/>", t.close)) return { ok: false, reason: `<${t.tag}> has no children to add to` };
  const at = t.close + 1;
  const lineStart = source.lastIndexOf("\n", t.start) + 1;
  const indent = /^\s*/.exec(source.slice(lineStart))![0];
  const edit = { start: at, end: at, text: `\n${indent}  ${element}` };
  return { ok: true, edits: [edit], source: apply(source, [edit]) };
}
