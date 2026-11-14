import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../src/cli/index.ts");
let dir = "";

const MODEL = `import { defineParams } from "tscad"
export const params = defineParams({
  size: { type: "number", default: 10, min: 1, max: 100, unit: "mm" },
})
export default function Cube({ size }: { size: number }) {
  return (
    <part name="cube" material="pla">
      <box size={size} />
    </part>
  )
}
`;

const BAD = `export default function Bad() {
  return (
    <part name="bad">
      <fillet radius={50}>
        <box size={10} />
      </fillet>
    </part>
  )
}
`;

const run = (...args: string[]) => Bun.spawnSync(["bun", CLI, ...args], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tscad-build-"));
  // tsconfig as `tscad init` writes it (also works without one: the CLI maps the JSX runtime).
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "tscad" } }));
  writeFileSync(join(dir, "cube.tsx"), MODEL);
  writeFileSync(join(dir, "bad.tsx"), BAD);
});

describe("tscad build", () => {
  test("binary STL and STEP from a tiny model, with --param", () => {
    const r = run("build", "cube.tsx", "-o", "out/cube.stl", "-o", "out/cube.step", "-p", "size=20");
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain("cube");
    expect(out).toContain("8,000 mm³"); // 20³
    expect(out).toContain("mass");

    const stl = readFileSync(join(dir, "out/cube.stl"));
    const tris = stl.readUInt32LE(80);
    expect(tris).toBe(12);
    expect(stl.byteLength).toBe(84 + 50 * tris);
    // Bounds of the STL vertices = the 20 mm cube.
    const max = [-Infinity, -Infinity, -Infinity], min = [Infinity, Infinity, Infinity];
    for (let t = 0; t < tris; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
      const x = stl.readFloatLE(84 + 50 * t + 12 + 12 * v + 4 * k);
      max[k] = Math.max(max[k]!, x);
      min[k] = Math.min(min[k]!, x);
    }
    for (let k = 0; k < 3; k++) expect(max[k]! - min[k]!).toBeCloseTo(20, 4);

    const step = readFileSync(join(dir, "out/cube.step"), "utf8");
    expect(step.startsWith("ISO-10303-21;")).toBe(true);
    expect(step).toContain("MANIFOLD_SOLID_BREP");
    expect(step.trimEnd().endsWith("END-ISO-10303-21;")).toBe(true);
  }, 60_000);

  test("--json output", () => {
    const r = run("build", "cube.tsx", "-o", "c.glb", "--json");
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout.toString());
    expect(j.parts[0].name).toBe("cube");
    expect(j.parts[0].volume).toBeCloseTo(1000, 3);
    expect(readFileSync(join(dir, "c.glb")).subarray(0, 4).toString()).toBe("glTF");
  }, 60_000);

  test("a kernel error exits 1 and points at the TSX line", () => {
    const r = run("build", "bad.tsx", "-o", "bad.stl");
    expect(r.exitCode).toBe(1);
    const err = r.stderr.toString();
    expect(err).toContain("fillet");
    expect(err).toMatch(/bad\.tsx:4:\d+/);
    expect(err).toContain("<fillet radius={50}>");
  }, 60_000);

  test("missing file, unknown part and bad format", () => {
    expect(run("build", "nope.tsx").exitCode).toBe(1);
    expect(run("build", "cube.tsx", "--part", "ghost").exitCode).toBe(2);
    expect(run("build", "cube.tsx", "-o", "x.dwg").exitCode).toBe(2);
  }, 60_000);

  test("a model anywhere, with no tsconfig and no node_modules, builds", () => {
    const bare = mkdtempSync(join(tmpdir(), "tscad-bare-"));
    writeFileSync(join(bare, "m.tsx"), `export default () => <box size={5} />\n`);
    const r = Bun.spawnSync(["bun", CLI, "build", "m.tsx", "-o", "m.stl"], { cwd: bare, env: { ...process.env, NO_COLOR: "1" } });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(bare, "m.stl")).readUInt32LE(80)).toBe(12);
  }, 60_000);

  test("tscad render writes a PNG", () => {
    const r = run("render", "cube.tsx", "-o", "shot.png", "--width", "320", "--height", "200", "--view", "top");
    expect(r.exitCode).toBe(0);
    const png = readFileSync(join(dir, "shot.png"));
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(320);
    expect(png.readUInt32BE(20)).toBe(200);
    expect(run("render", "cube.tsx", "--view", "sideways").exitCode).toBe(2);
  }, 60_000);

  test("tscad info lists params and parts", () => {
    const r = run("info", "cube.tsx", "--json");
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout.toString());
    expect(j.params.size.default).toBe(10);
    expect(j.parts[0].bbox[1][0] - j.parts[0].bbox[0][0]).toBeCloseTo(10, 6);
  }, 60_000);
});
