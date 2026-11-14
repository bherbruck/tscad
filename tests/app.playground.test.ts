import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractExports, extractIntrinsics, extractMaterials, extractSelectorMethods } from "../src/playground/extract";
import { decodeSource, encodeSource } from "../src/playground/share";
import { rewriteImports, transformModel } from "../src/playground/transform";
import { describeExample } from "../scripts/build-playground";
import { renderModule } from "../src";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const EXAMPLES = readdirSync(join(ROOT, "examples")).filter((f) => f.endsWith(".tsx"));

/** In bun, point the playground's runtime specifiers at the library sources. */
const localRuntime = (spec: string) =>
  ({
    tscad: pathToFileURL(join(SRC, "index.ts")).href,
    "tscad/jsx-runtime": pathToFileURL(join(SRC, "jsx-runtime.ts")).href,
    "tscad/jsx-dev-runtime": pathToFileURL(join(SRC, "jsx-dev-runtime.ts")).href,
    "tscad/parts": pathToFileURL(join(SRC, "parts/index.ts")).href,
  })[spec];

describe("playground transform", () => {
  test("TSX → ESM with tscad imports pointed at the bundle, line numbers kept", () => {
    const src = `import { edges, type ParamValues } from "tscad"\ntype P = { a: number }\nexport default function M(p: P) {\n  return <part name="x"><fillet radius={1} edges={edges.top()}><box size={p.a} /></fillet></part>\n}\n`;
    const out = transformModel(src, "model.tsx", (s) => `https://x/lib/${s}.js`);
    expect(out.code).toContain('from "https://x/lib/tscad.js"');
    expect(out.code).toContain('from "https://x/lib/tscad/jsx-runtime.js"');
    expect(out.code).not.toContain("type P");
    // sucrase preserves lines: the JSX is still on line 4.
    expect(out.code.split("\n")[3]).toContain("_jsx");
    expect(out.map.sources).toEqual(["model.tsx"]);
    expect(out.map.sourcesContent).toEqual([src]);
  });

  test("syntax errors carry line and column", () => {
    try {
      transformModel(`export default function M() {\n  const a = 1 +* 2\n  return <box size={a} />\n}`, "model.tsx", () => "x");
      throw new Error("no throw");
    } catch (e: any) {
      expect(e.line).toBe(2);
      expect(e.column).toBeGreaterThan(1);
      expect(e.message).not.toContain("Error transforming");
    }
  });

  test("relative imports are rejected with a hint; npm packages go to a CDN", () => {
    expect(() => transformModel(`import { a } from "./other"\nexport default () => a`, "model.tsx", () => "x")).toThrow(/single file/);
    const out = transformModel(`import chroma from "chroma-js"\nexport default () => chroma`, "model.tsx", () => "x");
    expect(out.code).toContain('"https://esm.sh/chroma-js"');
  });

  test("rewriteImports handles every import form", () => {
    const code = `import a from "a"\nimport { b } from 'b'\nimport "c"\nexport { d } from "d"\nconst e = import("e")\nexport * from "f"`;
    expect(rewriteImports(code, (s) => s.toUpperCase())).toBe(`import a from "A"\nimport { b } from 'B'\nimport "C"\nexport { d } from "D"\nconst e = import("E")\nexport * from "F"`);
  });

  for (const f of EXAMPLES) {
    test(`example ${f} compiles in-browser style and renders`, async () => {
      const source = readFileSync(join(ROOT, "examples", f), "utf8");
      const out = transformModel(source, f, localRuntime);
      const dir = mkdtempSync(join(tmpdir(), "tscad-pg-"));
      const file = join(dir, f.replace(/\.tsx$/, ".mjs"));
      writeFileSync(file, out.code);
      const mod = await import(file);
      const r = renderModule(mod);
      expect(r.document.parts?.length).toBeGreaterThan(0);
    });
  }
});

describe("share links", () => {
  test("round trip, including unicode, and stays compact", () => {
    const src = readFileSync(join(ROOT, "examples/bracket.tsx"), "utf8") + "\n// Ø ° — ✓ 🎉\n";
    const enc = encodeSource(src);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSource(enc)).toBe(src);
    expect(enc.length).toBeLessThan(src.length * 0.6);
  });
});

describe("completion data", () => {
  const intrinsics = readFileSync(join(SRC, "core/intrinsics.ts"), "utf8");
  test("every intrinsic element with inherited props and docs", () => {
    const tags = extractIntrinsics(intrinsics);
    const names = tags.map((t) => t.tag);
    for (const t of ["part", "box", "cylinder", "extrude", "fillet", "shell", "difference", "rect", "circle"]) expect(names).toContain(t);
    const box = tags.find((t) => t.tag === "box")!;
    expect(box.doc.length).toBeGreaterThan(5);
    const props = box.props.map((p) => p.name);
    expect(props).toContain("size");
    expect(props).toContain("x"); // from Placement
    expect(props).not.toContain("key");
    const fillet = tags.find((t) => t.tag === "fillet")!;
    expect(fillet.props.find((p) => p.name === "edges")?.doc).toMatch(/edges/);
    // Interfaces with an empty body don't swallow their neighbours.
    expect(tags.find((t) => t.tag === "difference")!.props.map((p) => p.name)).toContain("children");
  });

  test("selector methods, exports, materials", () => {
    const sel = extractSelectorMethods(readFileSync(join(SRC, "core/select.ts"), "utf8")).map((m) => m.name);
    for (const m of ["top", "bottom", "vertical", "circles", "radius", "and", "or", "not"]) expect(sel).toContain(m);
    const exp = extractExports(readFileSync(join(SRC, "index.ts"), "utf8")).map((m) => m.name);
    for (const m of ["defineParams", "edges", "faces", "renderModule"]) expect(exp).toContain(m);
    expect(exp).not.toContain("ParamValues");
    expect(extractMaterials(readFileSync(join(SRC, "core/materials.ts"), "utf8")).map((m) => m.name)).toContain("pla");
  });

  test("example titles", () => {
    const e = describeExample("bracket", `/**\n * L-shaped mounting bracket: a filleted base plate.\n *\n *   tscad dev examples/bracket.tsx\n */\n`);
    expect(e.title).toBe("L-shaped mounting bracket");
    expect(e.description).toBe("a filleted base plate.");
  });
});

describe("static build", () => {
  let out = join(ROOT, "dist/playground");

  beforeAll(() => {
    // CI builds dist/playground first; locally, build a dev copy into a temp dir.
    if (existsSync(join(out, "index.html"))) return;
    out = mkdtempSync(join(tmpdir(), "tscad-pg-build-"));
    const r = Bun.spawnSync(["bun", join(ROOT, "scripts/build-playground.ts"), "--dev", "--out", out]);
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  }, 120_000);

  test("is self-contained: every referenced file exists, paths are relative", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const r of refs) expect(existsSync(join(out, r))).toBe(true);
    expect(html).not.toMatch(/(?:src|href)="\/(?!\/)/); // no root-absolute paths (Pages serves under /<repo>/)
    for (const f of ["__tscad/index.js", "__tscad/jsx-runtime.js", "__tscad/parts/index.js", "__tscad/viewer/worker.js", "__tscad/playground/main.js", "wasm/tscad_wasm.js", "wasm/tscad_wasm_bg.wasm", ".nojekyll"]) {
      expect(existsSync(join(out, f))).toBe(true);
    }
  });

  test("ships every example and the completion data", () => {
    const examples = JSON.parse(readFileSync(join(out, "examples.json"), "utf8"));
    expect(examples.length).toBe(EXAMPLES.length);
    expect(examples[0].name).toBe("bracket");
    for (const e of examples) expect(e.title.length).toBeGreaterThan(2);
    const c = JSON.parse(readFileSync(join(out, "completions.json"), "utf8"));
    expect(c.tags.length).toBeGreaterThan(30);
  });
});
