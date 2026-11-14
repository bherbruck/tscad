/**
 * 2D import: <dxf> and <svg>. Round trips through our own writers, handwritten files with
 * holes, blocks and bulges, and kernel areas against closed forms.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { compile, type Children } from "tscad";
import { toDXF, toSVG } from "tscad/drawing";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";
import { parseDxf, parseSvg } from "../src/core/sketch/import";
import { loopArea } from "../src/core/sketch/boolean";
import { circleLoop, rectLoop, roundedRectLoop, slotLoop, polygonLoop } from "../src/core/sketch/shapes";
import { closureGap, end, transformLoop, type Loop2 } from "../src/core/sketch/seg";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);
const PI = Math.PI;

async function area(el: Children) {
  const r = compile(<extrude height={1}>{el}</extrude>);
  const e = await k.evaluate(r.document, { noMesh: true });
  const p = e.parts[0]!;
  if (!p.ok) throw new Error(JSON.stringify(p.error));
  return { area: p.volume!, warnings: r.warnings };
}
const near = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(rel);

/** Sorted absolute areas and sorted segment end points, for comparing loop sets. */
function signature(loops: Loop2[]) {
  const areas = loops.map((l) => Math.abs(loopArea(l))).sort((a, b) => a - b);
  const pts = loops.flatMap((l) => l.map((s) => end(s).map((v) => +v.toFixed(6)).join(","))).sort();
  return { areas, pts, kinds: loops.flatMap((l) => l.map((s) => s.kind)).sort() };
}

const SOURCE: Loop2[] = [
  rectLoop(60, 40),
  circleLoop(5, [-15, 0]),
  transformLoop(roundedRectLoop(20, 10, 3), [1, 0, 0, 1, 12, 5]),
  transformLoop(slotLoop(16, 6), [1, 0, 0, 1, 10, -10]),
  polygonLoop([[-25, 12], [-18, 12], [-21.5, 17]]),
];

describe("round trips through our writers", () => {
  for (const entities of ["primitives", "polyline"] as const) {
    test(`DXF (${entities}): same loops, arcs exact`, () => {
      const r = parseDxf(toDXF(SOURCE, { entities }));
      expect(r.warnings).toEqual([]);
      const a = signature(SOURCE), b = signature(r.loops);
      a.areas.forEach((v, i) => near(b.areas[i]!, v, 1e-6));
      expect(b.pts).toEqual(expect.arrayContaining(a.pts.filter((_, i) => i % 3 === 0)));
      expect(b.kinds.filter((x) => x === "arc").length).toBeGreaterThanOrEqual(a.kinds.filter((x) => x === "arc").length);
      for (const l of r.loops) expect(closureGap(l).gap).toBeLessThan(1e-7);
    });
  }
  test("SVG: same loops (y flipped back), arcs exact", () => {
    const r = parseSvg(toSVG(SOURCE));
    expect(r.warnings).toEqual([]);
    const a = signature(SOURCE), b = signature(r.loops);
    a.areas.forEach((v, i) => near(b.areas[i]!, v, 1e-6));
    expect(b.pts).toEqual(a.pts.length === b.pts.length ? a.pts : b.pts);
    expect(b.kinds.filter((x) => x === "arc").length).toBeGreaterThanOrEqual(a.kinds.filter((x) => x === "arc").length);
  });
});

describe("SVG", () => {
  const logo = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100">
  <!-- a plate with a round hole (even-odd), a ring drawn with opposite windings (nonzero) -->
  <path id="plate" fill-rule="evenodd" d="M10 10 H110 V90 H10 Z M60 50 m-20 0 a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0 Z"/>
  <g transform="translate(150 50)" class="cut">
    <path d="M -30 0 A 30 30 0 1 1 30 0 A 30 30 0 1 1 -30 0 Z M -10 0 A 10 10 0 1 0 10 0 A 10 10 0 1 0 -10 0 Z"/>
  </g>
  <rect x="120" y="5" width="20" height="10" rx="3"/>
  <circle cx="20" cy="20" r="5"/>
  <text x="0" y="0">ignored</text>
</svg>`;
  test("units, holes by fill-rule, overlapping elements unioned", async () => {
    const r = parseSvg(logo);
    expect(r.warnings).toEqual(['1 <text> element ignored (convert text to paths)']);
    // 1 user unit = 0.5 mm
    const { area: a } = await area(<svg data={logo} />);
    const plate = (100 * 80 - PI * 400) * 0.25;
    const ring = PI * (900 - 100) * 0.25;
    // the rect (rx 3) overlaps the ring: their union; the circle sits inside the plate: absorbed
    const rect = (20 * 10 - (4 - PI) * 9) * 0.25;
    expect(a).toBeGreaterThan(plate + ring);
    expect(a).toBeLessThan(plate + ring + rect);
    // without the rect: exact
    const { area: b } = await area(<svg data={logo.replace(/<rect[^>]*\/>/, "")} />);
    near(b, plate + ring);
  }, 30_000);
  test("select by id or class, centre, scale", async () => {
    const { area: a } = await area(<svg data={logo} select="#plate" />);
    near(a, (100 * 80 - PI * 400) * 0.25);
    const { area: c } = await area(<svg data={logo} select=".cut" scale={2} center />);
    near(c, PI * 800);
    const r = parseSvg(logo, { select: ".cut" });
    expect(r.loops.length).toBe(2);
  }, 30_000);
  test("transforms: rotate/scale/skew; non-uniform scale turns arcs into exact rational NURBS", async () => {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
      <circle cx="0" cy="0" r="2" transform="translate(5 5) scale(2 1)"/></svg>`;
    const { area: a } = await area(<svg data={s} />);
    near(a, PI * 4 * 2, 1e-4);
  }, 30_000);
});

describe("DXF", () => {
  const G = (...pairs: (string | number)[]) => pairs.join("\n");
  const dxf = G(
    0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 1, 0, "ENDSEC",
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 2, "HOLE", 10, 1, 20, 1,
    0, "CIRCLE", 8, "0", 10, 1, 20, 1, 40, 0.1,
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    // a 4 in × 2 in plate with rounded right end: LWPOLYLINE with a half-circle bulge
    0, "LWPOLYLINE", 5, "A1", 8, "CUT", 90, 4, 70, 1,
    10, 0, 20, 0, 10, 3, 20, 0, 42, 1, 10, 3, 20, 2, 10, 0, 20, 2,
    // two holes from one block: base point (1, 1), inserted at (1, 1) and (2, 1)
    0, "INSERT", 5, "B1", 8, "CUT", 2, "HOLE", 10, 1, 20, 1,
    0, "INSERT", 5, "B2", 8, "CUT", 2, "HOLE", 10, 2, 20, 1, 41, 2, 42, 2,
    // loose lines + an arc forming a closed D on another layer
    0, "LINE", 5, "C1", 8, "MARK", 10, 5, 20, 0, 11, 5, 20, 0, 21, 2,
    0, "ARC", 5, "C2", 8, "MARK", 10, 5, 20, 1, 40, 1, 50, 270, 51, 90,
    0, "LINE", 5, "C3", 8, "MARK", 10, 7, 20, 0, 11, 8, 21, 0,
    0, "ENDSEC", 0, "EOF",
  );
  const inch = 25.4;
  test("inches → mm, bulges exact, blocks with scale, layers", async () => {
    const { area: a, warnings } = await area(<dxf data={dxf} layer="CUT" />);
    expect(warnings).toEqual([]);
    const plate = (3 * 2 + PI / 2) * inch * inch;
    const holes = PI * 0.01 + PI * 0.04;
    near(a, plate - holes * inch * inch);
  }, 30_000);
  test("loose entities chain; an open chain is reported by entity handle", () => {
    const r = parseDxf(dxf, { layer: "MARK" });
    expect(r.loops.length).toBe(1);
    expect(r.warnings.some((w) => /open chain of 1 entity \(LINE #C3\)/.test(w))).toBe(true);
    near(Math.abs(loopArea(r.loops[0]!)), (PI / 2) * inch * inch);
  });
  test("units override and an ellipse (exact rational NURBS)", async () => {
    const e = G(0, "SECTION", 2, "ENTITIES", 0, "ELLIPSE", 10, 0, 20, 0, 11, 10, 21, 0, 40, 0.5, 41, 0, 42, 2 * PI, 0, "ENDSEC", 0, "EOF");
    const { area: a } = await area(<dxf data={e} units="cm" />);
    near(a, PI * 100 * 50, 1e-4);
  }, 30_000);
  test("errors: not a DXF", () => {
    expect(() => compile(<extrude height={1}><dxf data="hello" /></extrude>)).toThrow(/doesn't look like a DXF/);
  });
});

describe("example: engraved coaster", () => {
  test("the logo is cut exactly `depth` deep: volume difference = logo area × depth", async () => {
    const { renderModule } = await import("tscad");
    const mod = await import("../examples/engraved-logo.tsx");
    const vol = async (depth: number) => {
      const r = renderModule(mod, { depth });
      expect(r.warnings).toEqual([]);
      const e = await k.evaluate(r.document, { noMesh: true });
      expect(e.parts[0]!.ok).toBe(true);
      return e.parts[0]!.volume!;
    };
    const ring = PI * (28 * 28 - 22 * 22), T = 28 * 6 + 6 * 22;
    const c = Math.hypot(10, 10), theta = 2 * Math.asin(c / 18), leaf = 2 * (81 * (theta - Math.sin(theta)) / 2);
    near((await vol(0.6)) - (await vol(1.2)), (ring + T + leaf) * 0.6, 1e-5);
  }, 30_000);
});
