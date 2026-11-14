/**
 * OpenSCAD tokenizer. Comments are kept on the side (Customizer annotations live in them).
 */

export type TokKind = "num" | "str" | "id" | "op" | "eof";

export interface Token {
  kind: TokKind;
  /** Identifier / operator text, string contents (unescaped), or the number's source. */
  text: string;
  value?: number;
  line: number;
  col: number;
}

export interface Comment {
  text: string;
  line: number;
  /** Line the comment ends on (block comments). */
  endLine: number;
  block: boolean;
  /** True when code precedes it on its line (a trailing comment). */
  trailing: boolean;
}

export class ScadSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(`line ${line}:${col}: ${message}`);
  }
}

const OPS = ["<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "^", "<", ">", "!", "?", ":", "=", ",", ";", "(", ")", "[", "]", "{", "}", ".", "#"];

export function tokenize(src: string): { tokens: Token[]; comments: Comment[] } {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  let i = 0, line = 1, col = 1;
  let codeOnLine = false;
  const adv = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
        codeOnLine = false;
      } else col++;
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      adv(1);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const text = src.slice(i + 2, end < 0 ? src.length : end);
      comments.push({ text: text.trim(), line, endLine: line, block: false, trailing: codeOnLine });
      adv((end < 0 ? src.length : end) - i);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new ScadSyntaxError("unterminated /* comment", line, col);
      const start = line, trailing = codeOnLine;
      const text = src.slice(i + 2, end);
      adv(end + 2 - i);
      comments.push({ text: text.trim(), line: start, endLine: line, block: true, trailing });
      continue;
    }
    const l = line, cl = col;
    codeOnLine = true;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i))!;
      tokens.push({ kind: "num", text: m[0], value: Number(m[0]), line: l, col: cl });
      adv(m[0].length);
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ kind: "id", text: m[0], line: l, col: cl });
      adv(m[0].length);
      continue;
    }
    if (c === '"') {
      let j = i + 1, out = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\") {
          const e = src[j + 1];
          out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e ?? "";
          j += 2;
        } else out += src[j++];
      }
      if (j >= src.length) throw new ScadSyntaxError("unterminated string", l, cl);
      tokens.push({ kind: "str", text: out, line: l, col: cl });
      adv(j + 1 - i);
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ScadSyntaxError(`unexpected character ${JSON.stringify(c)}`, l, cl);
    tokens.push({ kind: "op", text: op, line: l, col: cl });
    adv(op.length);
  }
  tokens.push({ kind: "eof", text: "", line, col });
  return { tokens, comments };
}
