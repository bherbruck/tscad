/**
 * 2D sketch booleans: area identities and point-membership checks on thousands of seeded random
 * cases (with deliberate coincident edges, tangencies and touching vertices), plus kernel
 * volumes of extruded results.
 */
import { describe, expect, test } from "bun:test";
import { compile } from "tscad";
import { booleanLoops, insideLoops, loopArea } from "../src/core/sketch/boolean";
import { circleLoop, polygonLoop, rectLoop, regularPolygonPoints, roundedRectLoop, slotLoop, starPoints } from "../src/core/sketch/shapes";
import { closureGap, mul2, rot2, tr2, transformLoop, type Loop2 } from "../src/core/sketch/seg";
import { loadKernel } from "../src/kernel/index.ts";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random shape (loops: an outer and sometimes a hole); sizes/positions snapped so edges coincide. */
interface Mix {
  /** Chance of snapping a size/position to an integer (coincidences, tangencies). */
  snap: number;
  /** Positions in ±spread/2. */
  spread: number;
  /** Chance of no rotation. */
  straight: number;
}
const LOOSE: Mix = { snap: 0.6, spread: 16, straight: 0.5 };
const TIGHT: Mix = { snap: 1, spread: 6, straight: 0.8 }; // everything on a grid: lots of shared edges

function shape(r: () => number, mix: Mix = LOOSE): { loops: Loop2[]; area: number; kind: string } {
  const snap = (v: number) => (r() < mix.snap ? Math.round(v) : v);
  const x = snap((r() - 0.5) * mix.spread), y = snap((r() - 0.5) * mix.spread);
  const rot = r() < mix.straight ? 0 : r() < 0.5 ? 90 : r() * 360;
  const m = mul2(tr2(x, y), rot2(rot));
  const k = Math.floor(r() * 7);
  const w = snap(2 + r() * 12), h = snap(2 + r() * 12);
  switch (k) {
    case 0:
      return { loops: [transformLoop(rectLoop(w, h), m)], area: w * h, kind: "rect" };
    case 1: {
      const rr = snap(1 + r() * 7);
      return { loops: [transformLoop(circleLoop(rr), m)], area: Math.PI * rr * rr, kind: "circle" };
    }
    case 2: {
      const L = Math.max(w, h), W = Math.min(w, h);
      return { loops: [transformLoop(slotLoop(L, W), m)], area: (L - W) * W + (Math.PI * W * W) / 4, kind: "slot" };
    }
    case 3: {
      const rad = Math.min(w, h) * 0.3;
      return { loops: [transformLoop(roundedRectLoop(w, h, rad), m)], area: w * h - (4 - Math.PI) * rad * rad, kind: "roundedRect" };
    }
    case 4: {
      const n = 3 + Math.floor(r() * 6), R = snap(2 + r() * 6);
      const loop = polygonLoop(regularPolygonPoints(n, R));
      return { loops: [transformLoop(loop, m)], area: Math.abs(loopArea(loop)), kind: "polygon" };
    }
    case 5: {
      const loop = polygonLoop(starPoints(5, 6, 2.5));
      return { loops: [transformLoop(loop, m)], area: Math.abs(loopArea(loop)), kind: "star" };
    }
    default: {
      // a ring: rect with a circular hole
      const rr = Math.min(w, h) * 0.3;
      return { loops: [transformLoop(rectLoop(w, h), m), transformLoop(circleLoop(rr), m)], area: w * h - Math.PI * rr * rr, kind: "plate" };
    }
  }
}

const area = (ls: Loop2[]) => ls.reduce((s, l) => s + loopArea(l), 0);

describe("sketch booleans: fuzz", () => {
  for (const [name, mix, seed] of [["loose", LOOSE, 20261114], ["grid-snapped", TIGHT, 7]] as const)
  test(`area identities and membership on 3000 seeded cases (${name})`, () => {
    const failures: string[] = [];
    const r = rng(seed);
    for (let n = 0; n < 3000 && failures.length < 10; n++) {
      const A = shape(r, mix), B = shape(r, mix);
      let U: Loop2[], I: Loop2[], D: Loop2[], E: Loop2[];
      try {
        U = booleanLoops("union", [A.loops, B.loops]);
        I = booleanLoops("intersection", [A.loops, B.loops]);
        D = booleanLoops("difference", [A.loops, B.loops]);
        E = booleanLoops("difference", [B.loops, A.loops]);
      } catch (e) {
        failures.push(`#${n} ${A.kind}/${B.kind}: threw ${(e as Error).message}`);
        continue;
      }
      const [u, i, d, e] = [area(U), area(I), area(D), area(E)];
      const scale = Math.max(1, A.area + B.area);
      const tol = 1e-7 * scale;
      // closed loops, results oriented with material on the left (positive total area)
      for (const ls of [U, I, D, E]) for (const l of ls) if (closureGap(l).gap > 1e-6) failures.push(`#${n}: open loop`);
      if (Math.abs(u + i - A.area - B.area) > tol) failures.push(`#${n} ${A.kind}/${B.kind}: |A∪B|+|A∩B| ${u + i} ≠ |A|+|B| ${A.area + B.area}`);
      if (Math.abs(d - (A.area - i)) > tol) failures.push(`#${n} ${A.kind}/${B.kind}: |A−B| ${d} ≠ |A|−|A∩B| ${A.area - i}`);
      if (Math.abs(e - (B.area - i)) > tol) failures.push(`#${n} ${A.kind}/${B.kind}: |B−A| ${e} ≠ |B|−|A∩B| ${B.area - i}`);
      // membership: the result agrees with the operands at sample points (away from boundaries)
      if (n % 10 === 0) {
        for (let k = 0; k < 60; k++) {
          const p: [number, number] = [(r() - 0.5) * 32, (r() - 0.5) * 32];
          const inA = insideLoops(p, A.loops), inB = insideLoops(p, B.loops);
          // skip points within 1e-4 of a boundary (membership flips nearby)
          const near = [[1e-4, 0], [-1e-4, 0], [0, 1e-4], [0, -1e-4]].some(([dx, dy]) => insideLoops([p[0] + dx!, p[1] + dy!], A.loops) !== inA || insideLoops([p[0] + dx!, p[1] + dy!], B.loops) !== inB);
          if (near) continue;
          const want = { U: inA || inB, I: inA && inB, D: inA && !inB };
          const got = { U: U.length > 0 && insideLoops(p, U), I: I.length > 0 && insideLoops(p, I), D: D.length > 0 && insideLoops(p, D) };
          for (const key of ["U", "I", "D"] as const) if (want[key] !== got[key]) failures.push(`#${n} ${A.kind}/${B.kind}: ${key} at ${p} want ${want[key]}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  test("degenerate cases: shared edges, identical shapes, tangent circles, containment", () => {
    const sq = (x: number, y: number, s = 10) => [transformLoop(rectLoop(s, s), tr2(x, y))];
    // side by side: union is one rectangle (4 lines), intersection empty
    const u = booleanLoops("union", [sq(0, 0), sq(10, 0)]);
    expect(u.length).toBe(1);
    expect(u[0]!.length).toBe(4);
    expect(area(u)).toBeCloseTo(200, 9);
    expect(booleanLoops("intersection", [sq(0, 0), sq(10, 0)])).toEqual([]);
    // identical
    expect(area(booleanLoops("union", [sq(0, 0), sq(0, 0)]))).toBeCloseTo(100, 9);
    expect(area(booleanLoops("intersection", [sq(0, 0), sq(0, 0)]))).toBeCloseTo(100, 9);
    expect(booleanLoops("difference", [sq(0, 0), sq(0, 0)])).toEqual([]);
    // corner touch: two loops meeting at one vertex stay two loops
    expect(booleanLoops("union", [sq(0, 0), sq(10, 10)]).length).toBe(2);
    // the same circle drawn from different start angles; internally tangent circles
    const rotc = [transformLoop(circleLoop(5), rot2(37))];
    expect(area(booleanLoops("union", [[circleLoop(5)], rotc]))).toBeCloseTo(25 * Math.PI, 9);
    expect(area(booleanLoops("difference", [[transformLoop(circleLoop(6), tr2(-1, 0))], [circleLoop(5)]]))).toBeCloseTo(11 * Math.PI, 9);
    // externally tangent circles
    const c1 = [circleLoop(5)], c2 = [transformLoop(circleLoop(5), tr2(10, 0))];
    expect(area(booleanLoops("union", [c1, c2]))).toBeCloseTo(50 * Math.PI, 9);
    expect(booleanLoops("intersection", [c1, c2])).toEqual([]);
    // containment: a hole
    const holed = booleanLoops("difference", [sq(0, 0, 20), [circleLoop(3)]]);
    expect(holed.length).toBe(2);
    expect(area(holed)).toBeCloseTo(400 - 9 * Math.PI, 9);
    // arcs stay arcs
    expect(holed.some((l) => l.some((s) => s.kind === "arc"))).toBe(true);
    // three operands
    expect(area(booleanLoops("union", [sq(0, 0), sq(5, 0), sq(10, 0)]))).toBeCloseTo(200, 9);
    expect(area(booleanLoops("difference", [sq(0, 0, 30), sq(-5, 0), sq(5, 0)]))).toBeCloseTo(900 - 200, 9);
  });
});

describe("overlapping shapes union; nested ones are holes", () => {
  const areaOf = (el: any) => area(compile(el).drawings[0]!.loops);
  test("a <sketch> operand is the union of its shapes (repro from the converter)", () => {
    const a = areaOf(
      <drawing>
        <difference2d>
          <rect size={[40, 10]} center={false} />
          <sketch>
            <circle r={2} x={10} y={5} />
            <rect size={[2, 10]} x={9} y={5} center={false} />
          </sketch>
        </difference2d>
      </drawing>,
    );
    const b = areaOf(
      <drawing>
        <difference2d>
          <rect size={[40, 10]} center={false} />
          <union2d>
            <circle r={2} x={10} y={5} />
            <rect size={[2, 10]} x={9} y={5} center={false} />
          </union2d>
        </difference2d>
      </drawing>,
    );
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeCloseTo(381.26, 2);
  });
  test("overlapping siblings in an extrude / drawing union instead of cancelling", async () => {
    const u = areaOf(<drawing><circle r={2} x={10} y={5} /><rect size={[2, 10]} x={9} y={5} center={false} /></drawing>);
    expect(u).toBeCloseTo(20 + 4 * Math.PI - area(booleanLoops("intersection", [[transformLoop(circleLoop(2), tr2(10, 5))], [transformLoop(rectLoop(2, 10), tr2(10, 10))]])), 9);
    // a hole inside the overlap of two outlines is still a hole
    expect(areaOf(<drawing><rect w={20} h={10} /><rect w={20} h={10} x={10} /><circle r={2} x={5} /></drawing>)).toBeCloseTo(300 - 4 * Math.PI, 9);
    // nested loops keep even-odd: an island in a hole is solid
    expect(areaOf(<drawing><circle r={10} /><circle r={6} /><circle r={3} /></drawing>)).toBeCloseTo(Math.PI * (100 - 36 + 9), 9);
    const k = await loadKernel();
    const r = await k.evaluate(compile(<extrude height={1}><rect w={20} h={10} /><rect w={20} h={10} x={10} /><circle r={2} x={5} /></extrude>).document, { noMesh: true });
    expect(r.parts[0]!.volume!).toBeCloseTo(300 - 4 * Math.PI, 3);
  }, 30_000);
});

describe("sketch boolean elements", () => {
  test("in extrudes, drawings and offsets; the kernel agrees", async () => {
    const k = await loadKernel();
    const d = compile(
      <part name="d">
        <extrude height={5}>
          <difference2d>
            <circle r={5} />
            <rect w={10} h={2} y={4} />
          </difference2d>
        </extrude>
      </part>,
    );
    const r = await k.evaluate(d.document, { noMesh: true });
    // a D: the disc minus the segment above y = 3
    const seg = 25 * Math.acos(3 / 5) - 3 * Math.sqrt(25 - 9);
    expect(r.parts[0]!.volume!).toBeCloseTo((Math.PI * 25 - seg) * 5, 3);
    const keyhole = compile(
      <drawing name="k">
        <sketchUnion>
          <circle r={4} />
          <slot length={16} width={3} x={-6} />
        </sketchUnion>
      </drawing>,
    );
    expect(keyhole.drawings[0]!.loops.length).toBe(1);
    const inter = compile(
      <extrude height={1}>
        <offset distance={1}>
          <intersection2d>
            <circle r={5} />
            <circle r={5} x={6} />
          </intersection2d>
        </offset>
      </extrude>,
    );
    expect((await k.evaluate(inter.document, { noMesh: true })).ok).toBe(true);
    // nested booleans and holes in operands
    const nested = compile(
      <extrude height={2}>
        <sketchDifference>
          <rect w={40} h={20} />
          <sketchUnion>
            <circle r={4} x={-8} />
            <circle r={4} x={-2} />
          </sketchUnion>
          <rect w={4} h={4} x={12} />
        </sketchDifference>
      </extrude>,
    );
    const nr = await k.evaluate(nested.document, { noMesh: true });
    expect(nr.ok).toBe(true);
    const lens = 2 * (16 * Math.acos(3 / 4) - 3 * Math.sqrt(16 - 9)); // overlap of the two circles
    expect(nr.parts[0]!.volume!).toBeCloseTo((800 - (2 * 16 * Math.PI - lens) - 16) * 2, 3);
  }, 60_000);

  test("errors", () => {
    expect(() => compile(<sketchUnion><circle r={1} /></sketchUnion>)).toThrow(/2D sketch shape/);
    expect(() => compile(<extrude height={1}><sketchUnion><box size={1} /></sketchUnion></extrude>)).toThrow(/is a solid/);
  });
});
