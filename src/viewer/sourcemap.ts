/** A tiny source-map v3 reader: map bundle positions back to TSX, and cut code frames. */
import type { CodeFrame, Loc } from "./protocol";

interface RawMap {
  sources: string[];
  sourcesContent?: (string | null)[];
  mappings: string;
  sourceRoot?: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

/** Segments per generated line: [genCol, src, srcLine, srcCol] (0-based), sorted by genCol. */
type Segment = [number, number, number, number];

export class SourceMap {
  readonly sources: string[];
  readonly contents: (string | null)[];
  #lines: Segment[][] = [];

  constructor(raw: RawMap) {
    this.sources = raw.sources.map((s) => (raw.sourceRoot ? raw.sourceRoot.replace(/\/?$/, "/") + s : s));
    this.contents = raw.sourcesContent ?? [];
    this.#decode(raw.mappings);
  }

  #decode(mappings: string) {
    let line: Segment[] = [];
    let src = 0, srcLine = 0, srcCol = 0;
    let genCol = 0;
    let i = 0;
    const fields: number[] = [];
    const n = mappings.length;
    while (i <= n) {
      const c = i < n ? mappings[i] : ";";
      if (c === ";" || c === ",") {
        if (fields.length >= 4) {
          genCol += fields[0]!;
          src += fields[1]!;
          srcLine += fields[2]!;
          srcCol += fields[3]!;
          line.push([genCol, src, srcLine, srcCol]);
        } else if (fields.length >= 1) {
          genCol += fields[0]!;
        }
        fields.length = 0;
        if (c === ";") {
          this.#lines.push(line);
          line = [];
          genCol = 0;
        }
        i++;
        continue;
      }
      // One VLQ value.
      let value = 0, shift = 0, digit: number;
      do {
        digit = B64_INDEX[mappings.charCodeAt(i++)]!;
        value += (digit & 31) << shift;
        shift += 5;
      } while (digit & 32);
      fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
    }
  }

  /** The original position of generated `line`:`column` (both 1-based). */
  lookup(line: number, column: number): Loc | undefined {
    const segs = this.#lines[line - 1];
    if (!segs || segs.length === 0) return undefined;
    const col = column - 1;
    let best: Segment | undefined;
    for (const s of segs) {
      if (s[0] <= col) best = s;
      else break;
    }
    best ??= segs[0]!;
    return { file: this.sources[best[1]] ?? "?", line: best[2] + 1, column: best[3] + 1 };
  }

  content(file: string): string | undefined {
    const i = this.sources.indexOf(file);
    return i >= 0 ? (this.contents[i] ?? undefined) : undefined;
  }
}

/** Lines `context` around `loc.line` of `text`. */
export function codeFrame(text: string, loc: Loc, context = 3): CodeFrame {
  const all = text.split("\n");
  const from = Math.max(1, loc.line - context);
  const to = Math.min(all.length, loc.line + context);
  const lines: [number, string][] = [];
  for (let n = from; n <= to; n++) lines.push([n, all[n - 1] ?? ""]);
  return { ...loc, lines };
}

/** Stack frames as `{ file, line, column }` (V8 `at f (url:l:c)` and Firefox/Safari `f@url:l:c`). */
export function parseStack(stack: string | undefined): Loc[] {
  if (!stack) return [];
  const out: Loc[] = [];
  for (const raw of stack.split("\n")) {
    const m = raw.match(/\(?((?:blob:)?(?:[a-z]+:\/\/|\/)[^\s()]*?):(\d+):(\d+)\)?\s*$/i) ?? raw.match(/@(.*?):(\d+):(\d+)\s*$/);
    if (m) out.push({ file: m[1]!, line: Number(m[2]), column: Number(m[3]) });
  }
  return out;
}

export function stripQuery(url: string): string {
  return url.replace(/[?#].*$/, "");
}
