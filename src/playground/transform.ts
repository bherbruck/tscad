/**
 * In-browser TSX → ES module: sucrase (TypeScript + automatic JSX runtime from `tscad`),
 * with `tscad` / `tscad/*` imports pointed at the bundled library. Sucrase keeps line numbers,
 * and its source map is passed to the worker so errors land on the right TSX line.
 */
import { transform as sucrase } from "sucrase";

export interface Transformed {
  code: string;
  map: { version: number; sources: string[]; sourcesContent: string[]; mappings: string; [k: string]: unknown };
}

export interface TransformError {
  message: string;
  line?: number;
  column?: number;
}

/**
 * Compile `source` (a .tsx model). `runtime` maps a `tscad` specifier to the URL of its bundle
 * (`tscad` → `.../lib/index.js`, `tscad/jsx-runtime` → `.../lib/jsx-runtime.js`).
 */
export function transformModel(source: string, file: string, runtime: (specifier: string) => string | undefined): Transformed {
  let out;
  try {
    out = sucrase(source, {
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
