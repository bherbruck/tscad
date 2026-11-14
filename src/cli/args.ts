/** Hand-rolled argument parsing: `cmd pos... --flag value --flag=value -o x --bool`. */
import { parseValue } from "../viewer/fmt";

export { parseValue };

/** How a command-line flag parses. */
export interface FlagSpec {
  /** Takes a value (otherwise boolean). */
  value?: boolean;
  /** May repeat; values collect into an array. */
  multiple?: boolean;
  alias?: string;
}

/** Parsed argv: the command, its positionals and its flags. */
export interface Parsed {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
  /** Unknown flags, for a friendly error. */
  unknown: string[];
}

export const COMMANDS = ["init", "dev", "build", "info", "render", "mcp", "convert", "plate"] as const;
/** A `tscad` subcommand. */
export type Command = (typeof COMMANDS)[number];

export const FLAGS: Record<string, FlagSpec> = {
  help: { alias: "h" },
  version: { alias: "v" },
  port: { value: true },
  host: { value: true },
  open: {},
  out: { value: true, multiple: true, alias: "o" },
  param: { value: true, multiple: true, alias: "p" },
  tolerance: { value: true, alias: "t" },
  part: { value: true, multiple: true },
  format: { value: true, alias: "f" },
  ascii: {},
  json: {},
  force: {},
  quiet: { alias: "q" },
  view: { value: true },
  width: { value: true },
  height: { value: true },
  background: { value: true },
  ortho: {},
  edges: {},
  "section-z": { value: true },
  "browser-eval": {},
  root: { value: true },
  diagnostics: {},
  "server-eval": {},
  name: { value: true },
  bed: { value: true },
  spacing: { value: true },
  copies: { value: true, multiple: true },
  orient: { value: true },
};

/** Parse argv (after `tscad`) against the flag specs; unknown flags are reported, not thrown. */
export function parseArgs(argv: string[], spec: Record<string, FlagSpec> = FLAGS): Parsed {
  const out: Parsed = { positionals: [], flags: {}, unknown: [] };
  const byAlias = new Map(Object.entries(spec).flatMap(([k, s]) => (s.alias ? [[s.alias, k] as const] : [])));
  const set = (name: string, v: string | boolean) => {
    const s = spec[name]!;
    if (s.multiple) {
      const prev = out.flags[name];
      out.flags[name] = [...(Array.isArray(prev) ? prev : []), String(v)];
    } else out.flags[name] = v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    let name: string | undefined, inline: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      inline = eq >= 0 ? a.slice(eq + 1) : undefined;
      if (name.startsWith("no-") && spec[name.slice(3)] && !spec[name.slice(3)]!.value) {
        out.flags[name.slice(3)] = false;
        continue;
      }
    } else if (a.startsWith("-") && a.length > 1 && isNaN(Number(a))) {
      const short = a.slice(1, 2);
      name = byAlias.get(short);
      if (!name) {
        out.unknown.push(a);
        continue;
      }
      inline = a.length > 2 ? a.slice(a[2] === "=" ? 3 : 2) : undefined;
    }
    if (name === undefined) {
      if (out.command === undefined && out.positionals.length === 0 && (COMMANDS as readonly string[]).includes(a)) out.command = a;
      else out.positionals.push(a);
      continue;
    }
    const s = spec[name];
    if (!s) {
      out.unknown.push(a);
      continue;
    }
    if (s.value) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`--${name} needs a value`);
      set(name, v);
    } else set(name, inline === undefined ? true : inline !== "false" && inline !== "0");
  }
  return out;
}

/** `["a=1", "b=x"]` → `{ a: 1, b: "x" }` (numbers and booleans parsed). */
export function parseParams(list: string[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of list ?? []) {
    for (const pair of item.split(",")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) throw new Error(`--param expects key=value, got "${pair}"`);
      out[pair.slice(0, eq).trim()] = parseValue(pair.slice(eq + 1).trim());
    }
  }
  return out;
}


/** A flag value as one string (the last one when the flag was repeated). */
export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : Array.isArray(v) ? v[v.length - 1] : undefined;
}

/** A flag value as a list (repeated flags, or one). */
export function list(v: unknown): string[] {
  return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
}
