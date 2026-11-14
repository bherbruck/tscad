/** Pure helpers (no `vscode` import): which files are models, where CodeLens goes, ranges. */
import { tagRange } from "../../../src/playground/source-range";

/** Does this TSX import tscad (a model or a component library)? */
export function importsTscad(text: string): boolean {
  return /^\s*import\s[^;]*?from\s*["']tscad(?:\/[\w-]+)?["']/m.test(text);
}

/** A model: imports tscad and has a default export. */
export function isModel(text: string): boolean {
  return importsTscad(text) && defaultExportLine(text) !== undefined;
}

/** 0-based line of the default export (`export default function X`, `export default X`). */
export function defaultExportLine(text: string): number | undefined {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^\s*export\s+default\b/.test(l));
  return i >= 0 ? i : undefined;
}

/** Which props a viewer dimension label came from, by kind (for selecting it). */
export const DIMENSION_PROPS: Record<string, string[]> = {
  length: ["length"],
  radius: ["radius", "r"],
  diameter: ["diameter", "d"],
  angle: ["angle", "value"],
  sweep: ["angle"],
  distance: ["distance", "value"],
  dx: ["dx"],
  dy: ["dy"],
};

export interface Span {
  /** 0-based. */
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

function offsetOf(text: string, line: number, col: number): number {
  let off = 0;
  for (let i = 1; i < line; i++) {
    const nl = text.indexOf("\n", off);
    if (nl < 0) return text.length;
    off = nl + 1;
  }
  return off + Math.max(0, col - 1);
}

function spanOf(text: string, from: number, to: number): Span {
  const before = text.slice(0, from);
  const startLine = before.split("\n").length - 1;
  const startCol = from - (before.lastIndexOf("\n") + 1);
  const mid = text.slice(0, to);
  const endLine = mid.split("\n").length - 1;
  const endCol = to - (mid.lastIndexOf("\n") + 1);
  return { startLine, startCol, endLine, endCol };
}

/**
 * The range to select for a 1-based `line`:`column`: the prop (`length={…}`) when `props` name
 * one on the JSX element there, else the whole opening tag, else the word at that spot.
 */
export function revealSpan(text: string, line: number, column: number, props?: string[]): Span {
  const at = Math.min(offsetOf(text, line, column), text.length);
  const r = tagRange(text, at, props);
  if (r) return spanOf(text, r.from, r.to);
  const word = /^[\w$.-]+/.exec(text.slice(at))?.[0] ?? "";
  return spanOf(text, at, at + Math.max(word.length, 1));
}

/** A squiggle: the element's tag name (`<fillet`) or the word at the spot (not the whole tag). */
export function squiggleSpan(text: string, line: number, column: number): Span {
  const at = Math.min(offsetOf(text, line, column), text.length);
  const rest = text.slice(at);
  const tag = /^<\/?[\w.$-]+/.exec(rest)?.[0];
  if (tag) return spanOf(text, at, at + tag.length);
  const word = /^[\w$.-]+/.exec(rest)?.[0];
  if (word) return spanOf(text, at, at + word.length);
  // Nothing useful under it: the line's text.
  const lineStart = at - (column - 1);
  const lineEnd = text.indexOf("\n", lineStart);
  const lineText = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const indent = lineText.length - lineText.trimStart().length;
  return spanOf(text, lineStart + indent, lineStart + Math.max(indent + 1, lineText.trimEnd().length));
}

export interface DiagnosticItem {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: string;
}

/** Diagnostics grouped by absolute file, with spans computed from each file's text. */
export function groupDiagnostics(items: DiagnosticItem[], read: (file: string) => string | undefined): Map<string, (Span & { severity: DiagnosticItem["severity"]; message: string; source: string })[]> {
  const out = new Map<string, (Span & { severity: DiagnosticItem["severity"]; message: string; source: string })[]>();
  for (const it of items) {
    const text = read(it.file);
    if (text === undefined) continue;
    const span = squiggleSpan(text, it.line, it.column);
    if (!out.has(it.file)) out.set(it.file, []);
    out.get(it.file)!.push({ ...span, severity: it.severity, message: it.message, source: it.source });
  }
  return out;
}
