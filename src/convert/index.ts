/**
 * OpenSCAD → tscad: `convertScad(source)` turns a .scad file into a tscad model (TSX).
 * See docs/convert.md for what is converted and how.
 */
import { Gen, type Warning } from "./scad/codegen";
import { ScadSyntaxError } from "./scad/lexer";
import { parse } from "./scad/parser";

export type { Warning } from "./scad/codegen";
export { ScadSyntaxError } from "./scad/lexer";
export { parse as parseScad, type Expr as ScadExpr, type Program as ScadProgram, type Stmt as ScadStmt } from "./scad/parser";

export interface ConvertOptions {
  /** Model name (default component name and doc header). Default `"Model"`. */
  name?: string;
}

export interface ConvertResult {
  /** The tscad model source. */
  tsx: string;
  /** What couldn't be converted exactly, by .scad line. */
  warnings: Warning[];
}

/**
 * Convert OpenSCAD source to a tscad model. Throws {@link ScadSyntaxError} (with line and
 * column) when the source doesn't parse.
 */
export function convertScad(source: string, options: ConvertOptions = {}): ConvertResult {
  const prog = parse(source);
  // a few passes so parameters learn their types from call sites (numbers stay plain arithmetic)
  let known = new Map<string, Set<any>>();
  for (let pass = 0; pass < 3; pass++) {
    const g = new Gen(prog, known);
    g.generate(options.name ?? "Model");
    known = g.seen;
  }
  const gen = new Gen(prog, known);
  const tsx = gen.generate(options.name ?? "Model");
  return { tsx, warnings: gen.warnings.sort((a, b) => a.line - b.line) };
}

export { ScadSyntaxError as SyntaxError };
void ScadSyntaxError;
