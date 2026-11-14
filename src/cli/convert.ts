/** `tscad convert in.scad [-o out.tsx]`: OpenSCAD → a tscad model. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { convertScad, ScadSyntaxError } from "../convert";
import { rel } from "./model";
import { c, codeFrame, sym } from "./ui";

/** `my-bracket_v2.scad` → `MyBracketV2`. */
export function componentName(file: string): string {
  const base = basename(file).replace(/\.[^.]+$/, "");
  const name = base.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_m, _s, ch: string) => ch.toUpperCase()).replace(/^[^a-zA-Z]+/, "");
  return name ? name[0]!.toUpperCase() + name.slice(1) : "Model";
}

/** Returns the exit code. `out` "-" prints the TSX to stdout. */
export function convert(opts: { file: string; out?: string; name?: string; force?: boolean }): number {
  const source = readFileSync(opts.file, "utf8");
  const out = opts.out ?? opts.file.replace(/\.scad$/i, "") + ".tsx";
  let result;
  try {
    result = convertScad(source, { name: opts.name ?? componentName(opts.file) });
  } catch (e) {
    if (e instanceof ScadSyntaxError) {
      console.error(`${sym.err} ${c.cyan(`${rel(resolve(opts.file))}:${e.line}:${e.col}`)} ${e.message.replace(/^line \d+:\d+: /, "")}`);
      console.error(codeFrame(source, e.line, e.col).split("\n").map((l) => `  ${l}`).join("\n"));
      return 1;
    }
    throw e;
  }
  for (const w of result.warnings) console.error(`${sym.warn} ${c.cyan(`${rel(resolve(opts.file))}:${w.line}:`)} ${w.message}`);
  if (out === "-") {
    process.stdout.write(result.tsx);
    return 0;
  }
  if (existsSync(out) && !opts.force) {
    console.error(`${sym.err} ${c.bold(out)} already exists ${c.gray("(use --force to overwrite, or -o another file)")}`);
    return 1;
  }
  writeFileSync(out, result.tsx);
  const n = result.warnings.length;
  console.error(`${sym.ok} ${c.bold(rel(resolve(out)))}${n ? c.yellow(` · ${n} note${n > 1 ? "s" : ""} above`) : ""}  ${c.gray(`next: tscad dev ${rel(resolve(out))}`)}`);
  return 0;
}
