import { describe, expect, test } from "bun:test";
import { arc3, compile, helix, polyline3, type Children, type Curve, type Node } from "tscad";
import { parsePath } from "../src/core/sketch/path";
import { regions } from "../src/core/sketch/place";
import { circleLoop, rectLoop } from "../src/core/sketch/shapes";
import { closureGap, nurbsPoint, polyline, signedArea, transformLoop, rot2, type Nurbs2 } from "../src/core/sketch/seg";

const ir = (el: Children): Node => compile(el).document.parts![0]!.node;

/** Every profile curve end-to-end and closed. */
function closed(profile: Curve[]): boolean {
  const ends = profile.map((c) => (c.type === "line" ? [c.start, c.end] : c.type === "nurbs" ? [c.points[0]!.slice(0, 3), c.points[c.points.length - 1]!.slice(0, 3)] : null));
  if (profile.length === 1 && profile[0]!.type === "arc") return true;
  for (let i = 0; i < profile.length; i++) {
    const c = profile[i]!, d = profile[(i + 1) % profile.length]!;
    const end = c.type === "arc" ? arcEnd(c, c.end) : ends[i]![1]!;
    const start = d.type === "arc" ? arcEnd(d, d.start) : ends[(i + 1) % profile.length]![0]!;
    if (Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!, end[2]! - start[2]!) > 1e-9) return false;
  }
  return true;
}
function arcEnd(c: Extract<Curve, { type: "arc" }>, t: number): number[] {
  const [a, r] = [c.axis, c.reference];
  const w = [a[1] * r[2] - a[2] * r[1], a[2] * r[0] - a[0] * r[2], a[0] * r[1] - a[1] * r[0]];
  return [0, 1, 2].map((i) => c.center[i]! + c.radius * (Math.cos(t) * r[i]! + Math.sin(t) * w[i]!));
}

describe("2D shapes → extrude profiles", () => {
  test("rect: centred, CCW, on z=0, extruded +Z", () => {
    const n = ir(<extrude height={5}><rect w={4} h={2} /></extrude>) as any;
    expect(n.type).toBe("extrude");
    expect(n.direction).toEqual([0, 0, 1]);
    expect(n.distance).toBe(5);
    expect(n.profile[0]).toEqual({ type: "line", start: [-2, -1, 0], end: [2, -1, 0] });
    expect(closed(n.profile)).toBe(true);
  });
  test("circle is one full arc", () => {
    expect((ir(<extrude h={1}><circle d={10} x={3} /></extrude>) as any).profile).toEqual([
      { type: "arc", center: [3, 0, 0], axis: [0, 0, 1], reference: [1, 0, 0], radius: 5, start: 0, end: 2 * Math.PI },
    ]);
  });
  test("every shape gives a closed loop", () => {
    const shapes = [
      <roundedRect w={20} h={10} r={3} />,
      <roundedRect w={10} h={10} r={5} />,
      <ellipse rx={5} ry={3} />,
      <polygon points={[[0, 0], [0, 5], [5, 0]]} />,
      <regularPolygon sides={6} r={5} rotate={15} />,
      <slot length={20} width={6} />,
      <star points={5} r1={10} r2={4} />,
      <path d="M0 0 h10 v5 a5 5 0 0 1 -10 0 z" />,
      <path d="M0 0 L10 0 C10 5 0 5 0 0" />,
      <path d="M0 0 H20 A10 4 30 0 1 0 0 Z" />,
      <rect w={4} h={2} mirror="x" rotate={30} at={[1, 1]} />,
    ];
    for (const s of shapes) {
      const n = ir(<extrude height={1}>{s}</extrude>) as any;
      expect(n.type).toBe("extrude");
      expect(closed(n.profile)).toBe(true);
    }
  });
  test("planes, offset, centre, negative height, draft", () => {
    const xz = ir(<extrude height={4} plane="XZ"><rect w={2} h={2} x={5} /></extrude>) as any;
    expect(xz.direction).toEqual([0, -1, 0]);
    expect(xz.profile[0].start).toEqual([4, 0, -1]);
    const yz = ir(<extrude height={4} plane="YZ" offset={2} center><circle r={1} /></extrude>) as any;
    expect(yz.direction).toEqual([1, 0, 0]);
    expect(yz.profile[0].center).toEqual([0, 0, 0]);
    expect(yz.profile[0].axis).toEqual([1, 0, 0]);
    const neg = ir(<extrude height={-3}><circle r={1} /></extrude>) as any;
    expect([neg.direction, neg.distance]).toEqual([[0, 0, -1], 3]);
    expect((ir(<extrude height={3} draft={45}><circle r={5} /></extrude>) as any).draft).toBeCloseTo(Math.PI / 4);
  });
});

describe("hole detection", () => {
  test("a loop inside another is subtracted", () => {
    const n = ir(<extrude height={5}><rect w={40} h={30} /><circle r={5} /></extrude>) as any;
    expect(n.type).toBe("difference");
    expect(n.children.map((c: any) => c.profile.length)).toEqual([4, 1]);
  });
  test("even-odd: island inside a hole is solid again; disjoint outlines union", () => {
    const n = ir(<extrude height={1}><circle r={20} /><circle r={15} /><circle r={10} /><circle r={5} /><circle r={2} x={50} /></extrude>) as any;
    expect(n.type).toBe("union");
    expect(n.children.map((c: any) => c.type)).toEqual(["difference", "difference", "extrude"]);
    expect(n.children[0].children.map((c: any) => c.profile[0].radius)).toEqual([20, 15]);
    expect(n.children[1].children.map((c: any) => c.profile[0].radius)).toEqual([10, 5]);
  });
  test("subpaths of one <path> nest too", () => {
    const n = ir(<extrude height={1}><path d="M-10 -10 H10 V10 H-10 Z M-2 -2 H2 V2 H-2 Z" /></extrude>) as any;
    expect(n.type).toBe("difference");
  });
  test("regions() on raw loops; concave containers", () => {
    const L = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]] as [number, number][];
    const ell = L.map((p, i) => ({ kind: "line" as const, a: p, b: L[(i + 1) % L.length]! }));
    const inCorner = circleLoop(2, [5, 5]);
    const inNotch = circleLoop(2, [20, 20]);
    const r = regions([ell, inCorner, inNotch], (l) => l);
    expect(r.length).toBe(2);
    expect(r[0]!.holes).toEqual([inCorner]);
    expect(r[1]!.outer).toBe(inNotch);
  });
  test("drafted holes taper the other way", () => {
    const n = ir(<extrude height={5} draft={3}><rect w={40} h={30} /><circle r={5} /></extrude>) as any;
    expect(n.children[0].draft).toBeCloseTo((3 * Math.PI) / 180);
    expect(n.children[1].draft).toBeCloseTo((-3 * Math.PI) / 180);
  });
});

describe("sketch helpers", () => {
  test("loops are wound CCW in the emitted profile", () => {
    const n = ir(<extrude height={1}><polygon points={[[0, 0], [0, 10], [10, 10], [10, 0]]} /></extrude>) as any;
    const pts = n.profile.map((c: any) => [c.start[0], c.start[1]]);
    expect(signedArea(pts)).toBeGreaterThan(0);
  });
  test("rotation keeps loops closed; arcs rotate exactly", () => {
    const l = transformLoop(rectLoop(4, 2), rot2(37));
    expect(closureGap(l).gap).toBeLessThan(1e-12);
    expect(Math.abs(signedArea(polyline(l)))).toBeCloseTo(8, 9);
  });
  test("path parser: commands, relative coords, implicit lineto, closure", () => {
    const [s] = parsePath("m 0 0 10 0 0 10 z");
    expect(s!.closed).toBe(true);
    expect(s!.segs.map((x) => x.kind)).toEqual(["line", "line", "line"]);
    const [q] = parsePath("M0 0 Q 5 10 10 0 T 20 0 Z");
    expect(q!.segs.map((x) => x.kind)).toEqual(["nurbs", "nurbs", "line"]);
    expect(nurbsPoint(q!.segs[0] as Nurbs2, 0.5)).toEqual([5, 5]);
    const [a] = parsePath("M10 0 A10 10 0 0 1 -10 0 Z");
    expect(a!.segs[0]).toMatchObject({ kind: "arc", r: 10 });
    expect(parsePath("M0 0 L 10 0")[0]!.closed).toBe(false);
    expect(() => parsePath("M0 0 L x 1")).toThrow(/unexpected/);
  });
  test("open sketch loops are located errors", () => {
    expect(() => compile(<extrude height={1}><path d="M0 0 L10 0 L10 10" /></extrude>)).toThrow(/core.sketch.test.tsx:\d+:\d+: <path> open sketch loop/);
    expect(() => compile(<extrude height={1}><box size={1} /></extrude>)).toThrow(/is a solid; <extrude> takes 2D shapes/);
    expect(() => compile(<extrude><circle r={1} /></extrude>)).toThrow(/missing height/);
    expect(() => compile(<extrude height={1} />)).toThrow(/has no 2D shapes/);
  });
});

describe("revolve / loft / sweep", () => {
  test("revolve: profile in XZ (x = radius, y = height), about +Z", () => {
    const n = ir(<revolve angle={90}><rect w={2} h={4} x={10} y={2} /></revolve>) as any;
    expect(n).toMatchObject({ type: "revolve", origin: [0, 0, 0], axis: [0, 0, 1] });
    expect(n.angle).toBeCloseTo(Math.PI / 2);
    expect(n.profile[0]).toEqual({ type: "line", start: [9, 0, 0], end: [11, 0, 0] });
    expect(() => compile(<revolve><circle r={5} /></revolve>)).toThrow(/crosses the axis/);
    expect(() => compile(<revolve angle={400}><circle r={1} x={5} /></revolve>)).toThrow(/angle/);
  });
  test("loft: shapes with z, or <section> wrappers", () => {
    const a = ir(<loft><rect w={10} h={10} z={0} /><circle r={3} z={10} /></loft>) as any;
    expect(a.sections.length).toBe(2);
    expect(a.sections[1][0].center).toEqual([0, 0, 10]);
    const b = ir(<loft ruled><section z={0}><circle r={5} /></section><section z={5}><circle r={4} /></section></loft>) as any;
    expect(b.ruled).toBe(true);
    expect(() => compile(<loft><circle r={1} /><circle r={1} z={1} /></loft>)).toThrow(/needs a z/);
    expect(() => compile(<loft><circle r={1} z={0} /></loft>)).toThrow(/at least 2 sections/);
  });
  test("sweep: profile placed square to the path start", () => {
    const n = ir(<sweep path={[[0, 0, 0], [0, 0, 10]]}><circle r={1} /></sweep>) as any;
    expect(n.path).toEqual(polyline3([[0, 0, 0], [0, 0, 10]]));
    expect(n.profile[0].axis).toEqual([0, 0, 1]);
    const h = ir(<sweep path={helix({ radius: 10, pitch: 2, turns: 1 })}><circle r={0.5} /></sweep>) as any;
    expect(h.profile[0].center).toEqual([10, 0, 0]);
    expect(Math.abs(h.profile[0].axis[1])).toBeGreaterThan(0.99);
  });
});

describe("path helpers", () => {
  test("helix is a C1 cubic NURBS on the helix", () => {
    const [c] = helix({ radius: 5, pitch: 2, turns: 2 }) as [Extract<Curve, { type: "nurbs" }>];
    expect(c.degree).toBe(3);
    expect(c.points.length).toBe(2 * 8 * 3 + 1);
    expect(c.knots.length).toBe(c.points.length + 4);
    expect(c.points[0]).toEqual([5, 0, 0, 1]);
    const last = c.points[c.points.length - 1]!;
    expect(last[0]).toBeCloseTo(5);
    expect(last[1]).toBeCloseTo(0);
    expect(last[2]).toBeCloseTo(4);
    // a mid-piece point stays on the cylinder
    const P = (u: number) => {
      const seg: Nurbs2 = { kind: "nurbs", degree: 3, pts: c.points.map((p) => [p[0], p[1], 1] as [number, number, number]), knots: c.knots };
      return nurbsPoint(seg, u);
    };
    for (const u of [0.03, 0.31, 0.77]) expect(Math.abs(Math.hypot(...P(u)) - 5)).toBeLessThan(5e-5);
    expect(() => helix({ radius: 0, pitch: 1, turns: 1 })).toThrow();
  });
  test("arc3 / polyline3", () => {
    expect(arc3({ radius: 2, end: 90 })[0]).toMatchObject({ type: "arc", radius: 2, start: 0, end: Math.PI / 2, axis: [0, 0, 1], reference: [1, 0, 0] });
    expect(polyline3([[0, 0, 0], [1, 0, 0], [1, 1, 0]], true).length).toBe(3);
  });
});
