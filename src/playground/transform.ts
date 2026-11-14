/**
 * In-browser TSX → ES module: sucrase (TypeScript + automatic JSX runtime from `tscad`),
 * with `tscad` / `tscad/*` imports pointed at the bundled library. Sucrase keeps line numbers,
 * and its source map is passed to the worker so errors land on the right TSX line.
 */
import { transform as sucrase } from "sucrase";

/** A model compiled for the browser: JS and its source map. */
export interface Transformed {
  code: string;
  map: { version: number; sources: string[]; sourcesContent: string[]; mappings: string; [k: string]: unknown };
}

/** A syntax error, located in the source. */
export interface TransformError {
  message: string;
  line?: number;
  column?: number;
}

/** `import name from "./x.svg" with { type: "text" }` (Bun text imports), for inlining. */
const TEXT_IMPORT = /^([ \t]*)import\s+([\w$]+)\s+from\s*(["'])([^"']+)\3\s*(?:with|assert)\s*\{\s*type\s*:\s*(["'])text\5\s*\}\s*;?/gm;

/** Local files a model imports as text (relative specifiers). */
export function textImports(source: string): string[] {
  return [...source.matchAll(TEXT_IMPORT)].map((m) => m[4]!).filter((s) => s.startsWith("."));
}

/** Local code modules a model imports (relative specifiers that aren't text imports). */
export function moduleImports(source: string): string[] {
  const text = new Set(textImports(source));
  const out = new Set<string>();
  rewriteImports(source.replace(TEXT_IMPORT, ""), (spec) => {
    if (spec.startsWith(".") && !text.has(spec)) out.add(spec);
    return spec;
  });
  return [...out];
}

/** `spec` resolved against directory `dir`, as a normalized relative path (`"."` is the model's own directory). */
export function joinPath(dir: string, spec: string): string {
  const out: string[] = [];
  for (const seg of `${dir}/${spec}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length && out[out.length - 1] !== "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** The directory part of a normalized relative path (`"."` for none). */
function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "." : path.slice(0, i);
}

const MODULE_EXTS = ["", ".tsx", ".ts", ".jsx", ".js"];

/** The `files` key of a local module import: `spec` from `dir`, with its extension found in `files`. */
export function resolveModule(files: Record<string, string>, dir: string, spec: string): string | undefined {
  const base = joinPath(dir, spec);
  return MODULE_EXTS.map((e) => base + e).find((k) => k in files);
}

/**
 * Compile `source` (a .tsx model). `runtime` maps a `tscad` specifier to the URL of its bundle
 * (`tscad` → `.../lib/index.js`, `tscad/jsx-runtime` → `.../lib/jsx-runtime.js`). Text imports of
 * files in `files` (`"./assets/logo.svg"` → contents) are inlined as string constants.
 */
export function transformModel(
  source: string,
  file: string,
  runtime: (specifier: string) => string | undefined,
  files: Record<string, string> = {},
  /** Turns a compiled local module into an importable URL (default: a blob: URL). */
  link: (code: string) => string = (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" })),
): Transformed {
  return compile(source, file, ".", runtime, files, link, new Map());
}

/**
 * Compile one module at `dir` (relative to the model). Local modules it imports from `files`
 * (keys like `"../spur-gear.tsx"`) are compiled the same way and linked by URL, once each.
 */
function compile(source: string, file: string, dir: string, runtime: (specifier: string) => string | undefined, files: Record<string, string>, link: (code: string) => string, linked: Map<string, string>): Transformed {
  // Text imports: by the specifier as written (share links) or by path from the model.
  const textOf = (spec: string) => (spec in files ? files[spec] : files[joinPath(dir, spec)]);
  // Same line, so line numbers stay put.
  const inlined = source.replace(TEXT_IMPORT, (m, indent: string, name: string, _q, spec: string) => {
    const text = textOf(spec);
    return text !== undefined ? `${indent}const ${name} = ${JSON.stringify(text)};` : m;
  });
  let out;
  try {
    out = sucrase(inlined, {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "automatic",
      jsxImportSource: "tscad",
      production: true,
      filePath: file,
      sourceMapOptions: { compiledFilename: file.replace(/\.[jt]sx?$/, ".js") },
    });
  } catch (e: any) {
    const err: TransformError = { message: String(e?.message ?? e).replace(/^Error transforming [^:]*:\s*/, "").replace(/\s*\(\d+:\d+\)$/, "") };
    if (e?.loc) {
      err.line = e.loc.line;
      err.column = e.loc.column + 1;
    }
    throw Object.assign(new Error(err.message), err);
  }
  const code = rewriteImports(out.code, (spec) => {
    if (spec === "tscad" || spec.startsWith("tscad/")) {
      const url = runtime(spec);
      if (!url) throw Object.assign(new Error(`unknown tscad module "${spec}"`), { line: lineOf(out.code, spec) });
      return url;
    }
    const local = spec.startsWith(".") ? resolveModule(files, dir, spec) : undefined;
    if (local) {
      let url = linked.get(local);
      if (!url) {
        linked.set(local, ""); // an import cycle links to nothing rather than recursing forever
        url = link(compile(files[local]!, local, dirOf(local), runtime, files, link, linked).code);
        linked.set(local, url);
      }
      return url;
    }
    if (spec.startsWith(".") || spec.startsWith("/")) {
      throw Object.assign(new Error(`the playground runs a single file — "${spec}" can't be imported here (use \`tscad dev\` for multi-file projects)`), { line: lineOf(out.code, spec) });
    }
    // Bare npm packages: an ES-module CDN.
    return `https://esm.sh/${spec}`;
  });
  const map = out.sourceMap as unknown as Transformed["map"];
  return { code, map: { ...map, sources: [file], sourcesContent: [source] } };
}

/** Rewrite the specifiers of static `import ... from "x"`, `export ... from "x"` and `import("x")`. */
export function rewriteImports(code: string, f: (spec: string) => string): string {
  return code
    .replace(/(\b(?:import|export)\b[^"'`;]*?\bfrom\s*)(["'])([^"']+)\2/g, (_m, pre, q, spec) => `${pre}${q}${f(spec)}${q}`)
    .replace(/(\bimport\s*)(["'])([^"']+)\2/g, (_m, pre, q, spec) => `${pre}${q}${f(spec)}${q}`)
    .replace(/(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g, (_m, pre, q, spec, post) => `${pre}${q}${f(spec)}${q}${post}`);
}

function lineOf(code: string, spec: string): number | undefined {
  const i = code.indexOf(`"${spec}"`);
  return i < 0 ? undefined : code.slice(0, i).split("\n").length;
}
