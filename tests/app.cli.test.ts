import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, parseParams } from "../src/cli/args";
import { formatOf } from "../src/cli/build";
import { selectorAttr, selectorBuilder, selectorString } from "../src/viewer/selectors";
import { codeFrame, parseStack, SourceMap } from "../src/viewer/sourcemap";
import { hashToValues } from "../src/viewer/params";
import { parseSelector } from "../src/core/select";
import type { Selector } from "../src/ir";

const CLI = join(import.meta.dir, "../src/cli/index.ts");

describe("parseArgs", () => {
  test("command, positionals and flags", () => {
    const a = parseArgs(["build", "model.tsx", "-o", "a.stl", "--out=b.step", "--param", "w=10", "-p", "h=2", "--tolerance", "0.05", "--open"]);
    expect(a.command).toBe("build");
    expect(a.positionals).toEqual(["model.tsx"]);
    expect(a.flags.out).toEqual(["a.stl", "b.step"]);
    expect(a.flags.param).toEqual(["w=10", "h=2"]);
    expect(a.flags.tolerance).toBe("0.05");
    expect(a.flags.open).toBe(true);
    expect(a.unknown).toEqual([]);
  });

  test("short flags with attached values, --no-x, --, unknown flags", () => {
    const a = parseArgs(["dev", "-oout.stl", "--no-open", "--bogus", "--", "--literal"]);
    expect(a.flags.out).toEqual(["out.stl"]);
    expect(a.flags.open).toBe(false);
    expect(a.unknown).toEqual(["--bogus"]);
    expect(a.positionals).toEqual(["--literal"]);
  });

  test("negative numbers are values, not flags", () => {
    expect(parseArgs(["build", "-p", "x=-3"]).flags.param).toEqual(["x=-3"]);
  });

  test("a value flag without a value throws", () => {
    expect(() => parseArgs(["dev", "--port"])).toThrow(/needs a value/);
  });

  test("parseParams types values and splits commas", () => {
    expect(parseParams(["a=1,b=true", "c=hello", "d=-2.5", "e='x y'"])).toEqual({ a: 1, b: true, c: "hello", d: -2.5, e: "x y" });
    expect(() => parseParams(["nope"])).toThrow(/key=value/);
  });

  test("formatOf picks the format from the extension", () => {
    expect(formatOf("a.STL")).toBe("stl");
    expect(formatOf("a.stp")).toBe("step");
    expect(formatOf("a", "3mf")).toBe("3mf");
    expect(formatOf("a.dxf")).toBe("dxf");
    expect(() => formatOf("a.dwg")).toThrow(/unknown export format/);
  });
});

describe("selectors → TSX", () => {
  const cases: [Selector, string | undefined, string][] = [
    [{ type: "max", axis: "z" }, ">Z", "edges.top()"],
    [{ type: "parallel", axis: "x" }, "|X", 'edges.parallel("x")'],
    [{ type: "and", of: [{ type: "max", axis: "z" }, { type: "perpendicular", axis: "z" }] }, ">Z and #Z", "edges.top().circles()"],
    [{ type: "or", of: [{ type: "min", axis: "z" }, { type: "parallel", axis: "z" }] }, "<Z or |Z", "edges.bottom().or(edges.vertical())"],
    [{ type: "not", of: { type: "max", axis: "y" } }, "not >Y", 'edges.max("y").not()'],
    [{ type: "radius", radius: 5 }, undefined, "edges.radius(5)"],
    [{ type: "and", of: [{ type: "radius", radius: 2.5 }, { type: "max", axis: "z" }] }, undefined, "edges.radius(2.5).top()"],
    [{ type: "index", indices: [3] }, undefined, "edges.index(3)"],
  ];
  for (const [sel, str, builder] of cases) {
    test(`${JSON.stringify(sel)}`, () => {
      expect(selectorString(sel)).toBe(str);
      expect(selectorBuilder(sel, "edges")).toBe(builder);
      // The string form must parse back to the same selector with the core's parser.
      if (str !== undefined) expect(parseSelector(str)).toEqual(sel);
    });
  }

  test("attributes: edges= for edges, open= for faces, builder fallback", () => {
    expect(selectorAttr({ type: "max", axis: "z" }, "edges", "string")).toBe('edges=">Z"');
    expect(selectorAttr({ type: "max", axis: "z" }, "faces", "builder")).toBe("open={faces.top()}");
    expect(selectorAttr({ type: "radius", radius: 1 }, "edges", "string")).toBe("edges={edges.radius(1)}");
  });
});

describe("viewer helpers", () => {
  test("source map lookup and code frame", () => {
    // gen line 1 col 0 → src 0 line 0 col 0; gen line 2 col 4 → src line 2 col 2
    const map = new SourceMap({ sources: ["model.tsx"], sourcesContent: ["a\nb\nccc\nd"], mappings: "AAAA;IAEE" });
    expect(map.lookup(1, 1)).toEqual({ file: "model.tsx", line: 1, column: 1 });
    expect(map.lookup(2, 9)).toEqual({ file: "model.tsx", line: 3, column: 3 });
    const frame = codeFrame(map.content("model.tsx")!, { file: "model.tsx", line: 3, column: 3 }, 1);
    expect(frame.lines).toEqual([[2, "b"], [3, "ccc"], [4, "d"]]);
  });

  test("parseStack reads V8 and Firefox frames", () => {
    const v8 = "Error\n    at Model (http://localhost:3333/__user/bundle.js?v=2:12:20)\n    at http://x/a.js:1:2";
    expect(parseStack(v8)[0]).toEqual({ file: "http://localhost:3333/__user/bundle.js?v=2", line: 12, column: 20 });
    expect(parseStack("Model@http://h/b.js:3:4")[0]).toEqual({ file: "http://h/b.js", line: 3, column: 4 });
  });

  test("hash params use the schema's types", () => {
    const schema = { w: { type: "number", default: 1 }, on: { type: "boolean", default: false }, s: { type: "choice", default: "a", options: ["a", "b"] } };
    expect(hashToValues("#w=12.5&on=1&s=b&junk=3", schema)).toEqual({ w: 12.5, on: true, s: "b" });
  });
});

describe("tscad CLI", () => {
  const run = (...args: string[]) => Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, NO_COLOR: "1" } });

  test("--help and --version", () => {
    const help = run("--help");
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("tscad build");
    const v = run("--version");
    expect(v.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("unknown command and option fail with code 2", () => {
    expect(run("frobnicate").exitCode).toBe(2);
    expect(run("build", "--bogus").exitCode).toBe(2);
  });

  test("init scaffolds a project and refuses to overwrite", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "tscad-init-")), "my model");
    const r = run("init", dir);
    expect(r.exitCode).toBe(0);
    for (const f of ["package.json", "tsconfig.json", "index.tsx", ".gitignore"]) expect(existsSync(join(dir, f))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-model");
    expect(pkg.dependencies.tscad).toBeDefined();
    expect(JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8")).compilerOptions.jsxImportSource).toBe("tscad");
    expect(run("init", dir).exitCode).toBe(1);
    expect(run("init", dir, "--force").exitCode).toBe(0);
    // The starter model builds.
    const b = Bun.spawnSync(["bun", CLI, "build", "-o", "out/model.stl"], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } });
    expect(b.stderr.toString()).toBe("");
    expect(b.exitCode).toBe(0);
    expect(readFileSync(join(dir, "out/model.stl")).byteLength).toBeGreaterThan(84);
  }, 60_000);
});
