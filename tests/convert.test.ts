/**
 * OpenSCAD → tscad: parser, codegen, and geometric equivalence (converted models evaluated by
 * the kernel against closed-form volumes).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { convertScad, parseScad, ScadSyntaxError } from "../src/convert";
import { renderModule } from "../src/index";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

const PI = Math.PI;
const TMP = new URL("./.convert-tmp/", import.meta.url);
let k: KernelHost;
let n = 0;
beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  k = await loadKernel();
}, 30_000);
afterAll(() => {
  if (!process.env.KEEP_CONVERTED) rmSync(TMP, { recursive: true, force: true });
});

/** Convert, load the TSX as a module, render and evaluate: total volume and warnings. */
async function run(scad: string, overrides: Record<string, unknown> = {}) {
  const { tsx, warnings } = convertScad(scad, { name: "Test" });
  const file = new URL(`m${++n}.tsx`, TMP);
  writeFileSync(file, tsx);
  const mod = await import(file.href);
  const r = renderModule(mod, overrides);
  const e = await k.evaluate(r.document, { noMesh: true });
  for (const p of e.parts) if (!p.ok) throw new Error(`kernel: ${JSON.stringify(p.error)}\n${tsx}`);
  const volume = e.parts.reduce((s, p) => s + (p.volume ?? 0), 0);
  return { tsx, warnings, volume, bbox: e.parts[0]?.bbox, r, mod };
}
/** Belt around two circles r1, r2 with centres d apart. */
const belt = (r1: number, r2: number, d: number) => {
  const phi = Math.asin((r1 - r2) / d), t = Math.sqrt(d * d - (r1 - r2) ** 2);
  return (r1 + r2) * t + 0.5 * r1 * r1 * (PI + 2 * phi) + 0.5 * r2 * r2 * (PI - 2 * phi);
};
const near = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(rel);

describe("parser", () => {
  test("expressions, comprehensions, modules, functions", () => {
    const p = parseScad(`
      a = 1 + 2 * 3 ^ 2;      // precedence
      v = [for (i = [0:2:10]) if (i % 4 == 0) i * 2];
      f = function(x) x > 0 ? x : -x;
      module m(s = 2) { children(); }
      function g(x, y = 3) = let(z = x * y) [z, each [1, 2]];
      include <MCAD/units.scad>
      #m() !cube(1);
    `);
    expect(p.body.map((s) => s.t)).toEqual(["assign", "assign", "assign", "module", "function", "use", "inst"]);
    const a = p.body[0] as any;
    expect(a.value.op).toBe("+");
    expect(a.value.r.op).toBe("*");
    expect(a.value.r.r.op).toBe("^");
    expect(p.comments[0]!.text).toBe("precedence");
    expect(p.comments[0]!.trailing).toBe(true);
  });
  test("syntax errors carry line and column", () => {
    expect(() => parseScad("cube(10;\n")).toThrow(ScadSyntaxError);
    try {
      parseScad("a = 1;\nb = [1, 2;\n");
    } catch (e) {
      expect((e as ScadSyntaxError).line).toBe(2);
    }
  });
});

describe("codegen", () => {
  test("Customizer annotations become params", () => {
    const { tsx } = convertScad(`
/* [Size] */
// Outer width
width = 40; // [10:2:100]
holes = 4; // [0:8]
label = "hi"; // 10
style = "round"; // [round, square]
quality = 2; // [1:Low, 2:Medium, 3:High]
on = true;
/* [Hidden] */
eps = 0.01;
cube(width);
`);
    expect(tsx).toContain(`width: { type: "int", default: 40, min: 10, max: 100, step: 2, description: "Outer width", group: "Size" }`);
    expect(tsx).toContain(`holes: { type: "int", default: 4, min: 0, max: 8, group: "Size" }`);
    expect(tsx).toContain(`label: { type: "text", default: "hi", maxLength: 10, group: "Size" }`);
    expect(tsx).toContain(`style: { type: "choice", default: "round", options: ["round", "square"], group: "Size" }`);
    expect(tsx).toContain(`optionLabels: { "1": "Low", "2": "Medium", "3": "High" }`);
    expect(tsx).toContain(`on: { type: "boolean", default: true, group: "Size" }`);
    expect(tsx).toContain(`const eps = 0.01`);
    expect(tsx).toContain(`<box size={width} center={false} />`);
  });
  test("modules hoist unless they read globals; untyped params learn number from call sites", () => {
    const { tsx } = convertScad(`
w = 10;
module plate(a, b) { cube([a, b, 1]); }
module uses_global() { cube(w); }
plate(w, 2 * w);
uses_global();
`);
    expect(tsx).toMatch(/^function Plate\(\{ a, b \}: \{ a: number; b: number \}\)/m);
    expect(tsx).toMatch(/^  function UsesGlobal\(\)/m);
  });
  test("warnings for unsupported features, with lines", () => {
    const { warnings } = convertScad(`use <lib.scad>\nhull() { sphere(1); }\npolyhedron([[0,0,0]], [[0]]);\nlinear_extrude(5, twist=90) square(2);\n`);
    const msg = warnings.map((w) => `${w.line}: ${w.message}`).join("\n");
    expect(msg).toContain("1: use <lib.scad>");
    expect(msg).toContain("2: 3D hull() is only converted for prisms");
    expect(msg).toContain("3: polyhedron() isn't supported");
    expect(msg).toContain("4: linear_extrude twist isn't supported");
  });
});

describe("geometric equivalence (kernel volumes)", () => {
  const cases: [string, string, number][] = [
    ["cube (corner at origin)", "cube([10, 20, 30]);", 6000],
    ["centred cube minus sphere", "difference() { cube(20, center = true); sphere(5); }", 8000 - (4 / 3) * PI * 125],
    ["cylinder, d and cone", "cylinder(h = 10, r = 5); translate([20, 0, 0]) cylinder(h = 10, d = 4); translate([40, 0, 0]) cylinder(10, 5, 2);", PI * 250 + PI * 40 + (PI * 10 * (25 + 10 + 4)) / 3],
    ["for loop of cubes", "for (i = [0 : 3]) translate([i * 20, 0, 0]) cube(10);", 4000],
    ["intersection", "intersection() { cube(10); translate([5, 5, 5]) cube(10); }", 125],
    ["rotate a/v and mirror", "rotate(a = 90, v = [1, 0, 0]) cube([1, 2, 3]); mirror([1, 0, 0]) translate([5, 0, 0]) cube(2);", 6 + 8],
    ["linear_extrude of a 2D difference (pushed to 3D)", "linear_extrude(5) difference() { square(20); translate([10, 10]) circle(5); }", (400 - 25 * PI) * 5],
    ["centred linear_extrude of a 2D union", "linear_extrude(height = 2, center = true) { square(10, center = true); translate([10, 0]) circle(r = 3); }", (100 + 9 * PI) * 2],
    ["rotate_extrude ring", "rotate_extrude() translate([10, 0]) square([5, 10]);", PI * (225 - 100) * 10],
    ["half torus", "rotate_extrude(angle = 180) translate([10, 0]) circle(2);", (PI * 4 * 2 * PI * 10) / 2],
    ["revolved 2D difference", "rotate_extrude() difference() { translate([10, 0]) square([10, 10]); translate([15, 5]) circle(2); }", PI * (400 - 100) * 10 - 2 * PI * 15 * PI * 4],
    ["polygon from a list comprehension", "pts = [for (i = [0 : 5]) [10 * cos(i * 60), 10 * sin(i * 60)]]; linear_extrude(2) polygon(pts);", ((3 * Math.sqrt(3)) / 2) * 100 * 2],
    ["polygon paths with a hole", "linear_extrude(1) polygon(points = [[0,0],[10,0],[10,10],[0,10],[2,2],[8,2],[8,8],[2,8]], paths = [[0,1,2,3],[4,5,6,7]]);", 64],
    ["offset r rounds, delta doesn't", "linear_extrude(1) offset(r = 1) square(10); translate([20, 0, 0]) linear_extrude(1) offset(delta = 1) square(10);", 100 + 40 + PI + 144],
    ["hexagonal prism ($fn = 6)", "cylinder(r = 5, h = 3, $fn = 6);", ((3 * Math.sqrt(3)) / 2) * 25 * 3],
    ["scaled circle = ellipse (revolve)", "rotate_extrude() translate([10, 0]) scale([1, 2]) circle(1);", 2 * PI * 10 * PI * 2],
    ["functions, let, ternary, recursion", "function f(x) = let(y = x * 2) y > 10 ? y : 10; function fact(n) = n <= 1 ? 1 : n * fact(n - 1); cube([f(3), f(8), fact(3)]);", 10 * 16 * 6],
    ["vector arithmetic", "v = [1, 2, 3]; s = v * 2 + [1, 1, 1]; cube(s);", 3 * 5 * 7],
    ["modules with defaults and children()", "module place(dx = 10, n = 2) { for (i = [0 : n - 1]) translate([i * dx, 0, 0]) children(); } place(30) cube(2); translate([0, 50, 0]) place(dx = 20, n = 3) cylinder(r = 5, h = 2);", 16 + 3 * PI * 50],
    ["children(i) and $children", "module pick() { children(1); translate([0, 0, 10 * $children]) children(0); } pick() { cube(1); cube(2); }", 1 + 8],
    ["2D module under linear_extrude and rotate_extrude", "module ring(r, t) { difference() { circle(r); circle(r - t); } } linear_extrude(3) ring(10, 2); translate([0, 0, 10]) rotate_extrude() translate([20, 0]) ring(3, 1);", 3 * PI * (100 - 64) + 2 * PI * 20 * PI * (9 - 4)],
    ["2D statement at top level is extruded 1 mm", "square([4, 5]);", 20],
    ["if/else and comparisons", "x = 3; if (x > 2) cube(2); else cube(3); if (x == 4) cube(10);", 8],
    ["intersection_for", "intersection_for (i = [0, 45]) rotate([0, 0, i]) cube(10, center = true);", 2 * 100 * (Math.SQRT2 - 1) * 10],
  ];
  for (const [name, scad, expected] of cases) {
    test(name, async () => {
      const { volume } = await run(scad);
      near(volume, expected);
    }, 30_000);
  }

  test("kitchen sink: each, let and C-style comprehensions, function literals, .x, color, nested module", async () => {
    const { volume, warnings } = await run(`
      sq = function(x) x * x;
      a = [for (i = [1 : 3]) let(j = i * 2) j];           // [2, 4, 6]
      b = [each a, for (i = 0; i < 2; i = i + 1) 10 + i]; // [2, 4, 6, 10, 11]
      c = [for (v = [[1, 2], [3, 4]]) v.y];                // [2, 4]
      module outer(n) {
        module inner(s) cube(s);
        color("red") for (k = [0 : n - 1]) translate([k * 10, 0, 0]) inner(c[k % 2]);
      }
      outer(len(b) - 3);                                    // cubes 2 and 4
      translate([0, 20, 0]) cube([sq(3), b[4] - 10, 1]);    // 9 × 1 × 1
    `);
    near(volume, 8 + 64 + 9);
    expect(warnings.map((w) => w.message)).toEqual(expect.arrayContaining(["color() dropped: set color on the <part> instead", "nested module inner is moved to file level"]));
  }, 30_000);

  test("2D hull() → <hull> (cam profile)", async () => {
    const { volume, tsx } = await run("linear_extrude(5) hull() { circle(10); translate([25, 0]) circle(4); }");
    expect(tsx).toContain("<hull>");
    near(volume, 5 * belt(10, 4, 25));
  }, 30_000);
  test("3D hull() of equal cylinders → extruded 2D hull (rounded plate)", async () => {
    const { volume, tsx, warnings } = await run("hull() for (x = [0, 30], y = [0, 20]) translate([x, y, 0]) cylinder(r = 5, h = 3);");
    expect(tsx).toContain("<extrude height={3}>");
    expect(warnings).toEqual([]);
    near(volume, 3 * (40 * 30 - 25 * (4 - PI)));
  }, 30_000);
  test("3D hull() of a cube and a cylinder", async () => {
    const { volume } = await run("hull() { cube([20, 10, 4]); translate([30, 5, 0]) cylinder(r = 5, h = 4); }");
    near(volume, 4 * (300 + 12.5 * PI));
  }, 30_000);
  test("other 3D hulls still warn", async () => {
    const { warnings } = convertScad("hull() { sphere(5); translate([10, 0, 0]) sphere(5); }");
    expect(warnings.some((w) => w.message.startsWith("3D hull() is only converted for prisms"))).toBe(true);
  });

  test("models: key tag (hull of four corner cylinders) and plate cam (2D hull)", async () => {
    const tag = await run(readFileSync(new URL("./fixtures/scad/rounded-tag.scad", import.meta.url), "utf8"));
    expect(tag.warnings).toEqual([]);
    near(tag.volume, 3 * (50 * 25 - 25 * (4 - PI) - 9 * PI));
    const cam = await run(readFileSync(new URL("./fixtures/scad/cam.scad", import.meta.url), "utf8"));
    expect(cam.warnings).toEqual([]);
    near(cam.volume, 6 * (belt(12, 5, 12 + 10 - 5) - 9 * PI));
  }, 30_000);

  test("models: parametric box with lid (both parts, then the base only)", async () => {
    const src = readFileSync(new URL("./fixtures/scad/box-with-lid.scad", import.meta.url), "utf8");
    const shell = (w: number, d: number, h: number, t: number) => w * d * h - (w - 2 * t) * (d - 2 * t) * (h - t);
    const lid = (w: number, d: number, t: number, lh: number) => {
      const i = t + 0.4;
      return w * d * t + (w - 2 * i) * (d - 2 * i) * (lh - t);
    };
    const both = await run(src);
    expect(both.warnings).toEqual([]);
    near(both.volume, shell(60, 40, 25, 2) + lid(60, 40, 2, 6));
    const base = await run(src, { part: "base", width: 80, wall: 3 });
    near(base.volume, shell(80, 40, 25, 3));
    expect(both.tsx).toContain(`part: { type: "choice", default: "both", options: ["base", "lid", "both"], description: "Which part to print", group: "Lid" }`);
  }, 30_000);

  test("models: knob with notches and a D-shaft bore", async () => {
    const src = readFileSync(new URL("./fixtures/scad/knob.scad", import.meta.url), "utf8");
    const { volume } = await run(src);
    const lens = (R: number, r: number, d: number) =>
      r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r)) + R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R)) - 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
    const dArea = PI * 9 - (9 * Math.acos(1.5 / 3) - 1.5 * Math.sqrt(9 - 2.25));
    near(volume, (PI * 225 - 12 * lens(15, 2, 15)) * 12 - dArea * 9);
  }, 30_000);

  test("models: hex key holder (recursive functions, $fn = 6 pockets)", async () => {
    const src = readFileSync(new URL("./fixtures/scad/hex-key-holder.scad", import.meta.url), "utf8");
    const { volume, warnings } = await run(src);
    expect(warnings.every((w) => w.message.includes("6-sided prism"))).toBe(true);
    const sizes = [1.5, 2, 2.5, 3, 4, 5, 6], sp = 4, depth = 15, cl = 0.3, base = 5;
    const ac = (f: number) => f / Math.cos(PI / 6);
    const off = (i: number): number => (i === 0 ? 0 : off(i - 1) + ac(sizes[i - 1]! + cl) / 2 + sp + ac(sizes[i]! + cl) / 2);
    const total = off(6) + ac(6 + cl) / 2 + sp + ac(1.5 + cl) / 2 + sp;
    const width = ac(6 + cl) + 2 * sp;
    const hex = (f: number) => ((3 * Math.sqrt(3)) / 2) * (ac(f) / 2) ** 2;
    near(volume, total * width * (depth + base) - sizes.reduce((s, f) => s + hex(f + cl) * depth, 0));
  }, 30_000);
});

describe("examples/converted", () => {
  const dir = new URL("../examples/converted/", import.meta.url);
  for (const name of ["box-with-lid", "knob", "hex-key-holder", "rounded-tag", "cam"]) {
    test(`${name}: up to date with the converter, evaluates in < 10 s`, async () => {
      const scad = readFileSync(new URL(`${name}.scad`, dir), "utf8");
      const pascal = name.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase());
      const tsx = readFileSync(new URL(`${name}.tsx`, dir), "utf8");
      expect(convertScad(scad, { name: pascal }).tsx).toBe(tsx);
      const t0 = performance.now();
      const r = renderModule(await import(new URL(`${name}.tsx`, dir).href));
      const e = await k.evaluate(r.document, { noMesh: true });
      expect(e.parts.every((p) => p.ok)).toBe(true);
      expect(performance.now() - t0).toBeLessThan(10_000);
    }, 30_000);
  }
});
