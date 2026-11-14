/** Terminal output: colours (respecting NO_COLOR / non-TTY), tables, code frames. */

const enabled = !process.env.NO_COLOR && (process.env.FORCE_COLOR ? true : !!process.stdout.isTTY);

const wrap = (open: number, close: number) => (s: string | number) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  accent: (s: string | number) => (enabled ? `\x1b[38;2;124;156;255m${s}\x1b[39m` : String(s)),
};

export const sym = {
  ok: enabled ? c.green("✓") : "ok",
  err: enabled ? c.red("✗") : "x",
  warn: enabled ? c.yellow("▲") : "!",
  arrow: enabled ? c.accent("➜") : "->",
  bolt: "⚡",
  dot: c.gray("·"),
};

export const logo = () => `${c.accent("◆")} ${c.bold("tscad")}`;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
export const visibleLength = (s: string) => s.replace(ANSI, "").length;

/** A table with box-drawing rules; `align` per column ("l" | "r"). */
export function table(head: string[], rows: string[][], align: ("l" | "r")[] = []): string {
  const widths = head.map((h, i) => Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[i] ?? ""))));
  const pad = (s: string, i: number) => {
    const n = widths[i]! - visibleLength(s);
    return align[i] === "r" ? " ".repeat(n) + s : s + " ".repeat(n);
  };
  const line = (cells: string[]) => "  " + cells.map(pad).join(c.gray("  │  "));
  const rule = "  " + widths.map((w) => c.gray("─".repeat(w))).join(c.gray("──┼──"));
  return [line(head.map((h) => c.bold(h))), rule, ...rows.map(line)].join("\n");
}

export function fmtNum(v: number | undefined, digits = 2): string {
  if (v === undefined || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const d = a >= 1000 ? 0 : a >= 100 ? 1 : digits;
  return v.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function fmtMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)}ms` : ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function fmtBytes(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`;
}

export function fmtVolume(mm3: number | undefined): string {
  if (mm3 === undefined) return "—";
  return mm3 >= 1e5 ? `${fmtNum(mm3 / 1000)} cm³` : `${fmtNum(mm3)} mm³`;
}

/** A code frame of `source` around 1-based `line`/`column`. */
export function codeFrame(source: string, line: number, column = 1, context = 2): string {
  const lines = source.split("\n");
  const from = Math.max(1, line - context), to = Math.min(lines.length, line + context);
  const w = String(to).length;
  const out: string[] = [];
  for (let n = from; n <= to; n++) {
    const hot = n === line;
    const gutter = `${hot ? c.red(">") : " "} ${c.gray(String(n).padStart(w))} ${c.gray("│")} `;
    out.push(gutter + (hot ? lines[n - 1] : c.dim(lines[n - 1] ?? "")));
    if (hot) out.push(`  ${" ".repeat(w)} ${c.gray("│")} ${" ".repeat(Math.max(0, column - 1))}${c.red("^")}`);
  }
  return out.join("\n");
}

export function fail(message: string): never {
  console.error(`${sym.err} ${message}`);
  process.exit(1);
}
