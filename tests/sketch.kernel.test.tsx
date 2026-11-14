/**
 * Constraint sketches through compile() and the real kernel: volumes against closed forms,
 * and the `result.sketches` metadata.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { compile, sketchPath, type Children } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
}, 30_000);

const PI = Math.PI;

async function volume(el: Children): Promise<number> {
  const { document } = compile(el);
  const r = await k.evaluate(document, { noMesh: true });
  const p = r.parts[0]!;
  if (!p.ok) throw new Error(`kernel: ${JSON.stringify(p.error)}`);
  return p.volume!;
}

/** A w × h rectangle centred on the origin, fully constrained. */
function Square({ w, h }: { w: number; h: number }) {
  return (
    <sketch>
      <point id="c" x={0} y={0} fixed />
      <line id="b" from="p1" to="p2" horizontal length={w} />
      <line from="p2" to="p3" vertical length={h} />
      <line from="p3" to="p4" horizontal />
      <line from="p4" to="p1" vertical />
      <symmetric a="p1" b="p3" about="c" />
    </sketch>
  );
}

/** Stadium-ish "U": base w, straight sides h, a tangent semicircle on top. */
function U({ w, h }: { w: number; h: number }) {
  return (
    <sketch>
      <point id="o" x={0} y={0} fixed />
      <line id="base" from="o" to="a" horizontal length={w} />
      <line id="right" from="a" to="b" vertical length={h} />
      <arc id="top" from="b" to="c" tangent="right" radius={w / 2} />
      <line id="left" from="c" to="o" tangent />
    </sketch>
  );
}

describe("constraint sketches in the kernel", () => {
  const cases: [string, Children, number][] = [
    ["rectangle", <extrude height={5}><Square w={40} h={20} /></extrude>, 40 * 20 * 5],
    ["triangle by three lengths", <extrude height={2}><sketch>
      <point id="a" fixed />
      <line from="a" to="b" horizontal length={30} />
      <line from="b" to="c" length={40} />
      <line from="c" to="a" length={50} />
    </sketch></extrude>, 600 * 2],
    ["U with tangent arc (true arc)", <extrude height={3}><U w={20} h={30} /></extrude>, (20 * 30 + (PI * 100) / 2) * 3],
    ["plate with a constrained hole (nested → hole)", <extrude height={4}><sketch>
      <point id="o" fixed />
      <line id="base" from="o" to="a" horizontal length={60} />
      <line from="a" to="b" vertical length={40} />
      <line from="b" to="c" horizontal />
      <line id="left" from="c" to="o" vertical />
      <circle id="hole" center="h" diameter={12} />
      <dimension a="h" b="base" distance={20} />
      <dimension a="h" b="left" distance={30} />
    </sketch></extrude>, (2400 - PI * 36) * 4],
    ["mixed with a plain shape", <extrude height={1}><sketch>
      <circle center={[0, 0]} r={10} fixed />
      <rect w={4} h={4} />
    </sketch></extrude>, PI * 100 - 16],
    ["revolved half-disc bead (Pappus)", <revolve><sketch>
      <point id="p" x={10} y={0} fixed />
      <line id="axis" from="p" to="q" vertical length={10} />
      <arc from="q" to="p" center="m" cw />
      <midpoint point="m" of="axis" />
    </sketch></revolve>, 2 * PI * (10 + (4 * 5) / (3 * PI)) * (PI * 25) / 2],
    ["ruled loft of constrained sections", <loft ruled>
      <section z={0}><Square w={20} h={20} /></section>
      <section z={10}><Square w={10} h={10} /></section>
    </loft>, (10 / 3) * (400 + 100 + 200)],
    ["sketchPath builder", <extrude height={2}><path d={sketchPath(0, 0).hLine(20).vLine(30).tangentArc(10, 180).close().d} /></extrude>, (600 + 50 * PI) * 2],
  ];
  for (const [name, el, expected] of cases) {
    test(name, async () => {
      const v = await volume(el);
      expect(Math.abs(v - expected) / expected).toBeLessThan(1e-6);
    }, 30_000);
  }

  test("arcs stay exact IR arcs", () => {
    const n = compile(<extrude height={3}><U w={20} h={30} /></extrude>).document.parts![0]!.node as any;
    const arcs = n.profile.filter((c: any) => c.type === "arc");
    expect(arcs.length).toBe(1);
    expect(arcs[0].radius).toBe(10);
    expect(arcs[0].center).toEqual([10, 30, 0]);
  });
});

describe("result.sketches", () => {
  test("path, plane and solved geometry for the viewer", () => {
    const r = compile(
      <part name="p">
        <extrude height={5} plane="XZ" x={100}>
          <Square w={40} h={20} />
        </extrude>
      </part>,
    );
    expect(r.sketches.length).toBe(1);
    const s = r.sketches[0]!;
    expect(s.status).toBe("ok");
    expect(s.dof).toBe(0);
    expect(s.path).toBe("parts/0/0");
    expect(r.document.parts![0]!.node.type).toBe("transform");
    // sketch (x, y) → model (x + 100, 0, y) on XZ
    const P = s.plane;
    const apply = (x: number, y: number) => [0, 1, 2].map((i) => P[i * 4]! * x + P[i * 4 + 1]! * y + P[i * 4 + 3]!);
    expect(apply(1, 2)).toEqual([101, 0, 2]);
    expect(s.entities.filter((e) => e.kind === "line").length).toBe(4);
    expect(s.dimensions.map((d) => d.text)).toEqual(["40", "20"]);
    const p3 = s.points.find((p) => p.id === "p3")!;
    expect([p3.x, Math.abs(p3.y), p3.free]).toEqual([20, 10, false]);
  });

  test("warnings carry the sketch's source line", () => {
    const r = compile(
      <extrude height={1}>
        <sketch>
          <line id="l1" from={[0, 0]} to={[10, 0]} />
          <line id="l2" from={[10, 0]} to={[0, 10]} />
          <line id="l3" from={[0, 10]} to="l1.start" />
          <coincident a="l1.end" b="l2.start" />
          <coincident a="l2.end" b="l3.start" />
        </sketch>
      </extrude>,
    );
    expect(r.warnings.some((w) => /sketch\.kernel\.test\.tsx:\d+:\d+: <sketch> under-constrained/.test(w))).toBe(true);
  });
});

describe("sketch examples", () => {
  async function evalModule(path: string, overrides: Record<string, unknown> = {}) {
    const { renderModule } = await import("tscad");
    const r = renderModule(await import(path), overrides);
    const e = await k.evaluate(r.document, { noMesh: true });
    return { r, part: e.parts[0]! };
  }

  test("link arm: tangent outline, bores and slot match the closed form", async () => {
    const { r, part } = await evalModule("../examples/sketch-link-arm.tsx", { edgeRound: 0 });
    expect(r.warnings).toEqual([]);
    expect(r.sketches[0]!.status).toBe("ok");
    const L = 90, R1 = 16, R2 = 10, t = 6, w = 6;
    const phi = Math.asin((R1 - R2) / L), tl = Math.sqrt(L * L - (R1 - R2) ** 2);
    const hull = (R1 + R2) * tl + 0.5 * R1 * R1 * (PI + 2 * phi) + 0.5 * R2 * R2 * (PI - 2 * phi);
    const slotLen = L - (R1 + 4 + w / 2) - (R2 + 4 + w / 2);
    const area = hull - PI * 36 - PI * 9 - (slotLen * w + PI * (w / 2) ** 2);
    expect(part.ok).toBe(true);
    expect(Math.abs(part.volume! - area * t) / (area * t)).toBeLessThan(1e-6);
  }, 30_000);

  test("link arm with its edge rounds evaluates", async () => {
    const { part } = await evalModule("../examples/sketch-link-arm.tsx");
    expect(part.ok).toBe(true);
  }, 30_000);

  test("pulley: revolved profile matches Pappus", async () => {
    const { r, part } = await evalModule("../examples/sketch-pulley.tsx");
    expect(r.warnings).toEqual([]);
    expect(r.sketches[0]!.dof).toBe(0);
    const a = (19 * PI) / 180, yq = 8, yg = yq - 8 * Math.tan(a);
    const lower: [number, number][] = [[5, 0], [13, 0], [13, 7], [26, 7], [26, 0], [40, 0], [40, yg], [32, yq]];
    const poly = [...lower, ...[...lower].reverse().map(([x, y]) => [x, 20 - y] as [number, number])];
    let A = 0, Cx = 0;
    poly.forEach(([x0, y0], i) => {
      const [x1, y1] = poly[(i + 1) % poly.length]!;
      const c = x0 * y1 - x1 * y0;
      A += c;
      Cx += (x0 + x1) * c;
    });
    A /= 2;
    Cx /= 6 * A;
    const expected = 2 * PI * Cx * Math.abs(A);
    expect(part.ok).toBe(true);
    expect(Math.abs(part.volume! - expected) / expected).toBeLessThan(1e-6);
  }, 30_000);

  test("a self-crossing profile (bow tie) is flagged", () => {
    const r = compile(
      <extrude height={1}>
        <sketch>
          <point id="o" fixed />
          <line from="o" to="a" horizontal length={10} />
          <line from="a" to="b" />
          <line from="b" to="c" />
          <line from="c" to="o" />
          <dimension a="o" b="b" dx={0} />
          <dimension a="o" b="b" dy={10} />
          <dimension a="b" b="c" dx={10} />
          <dimension a="b" b="c" dy={0} />
        </sketch>
      </extrude>,
    );
    expect(r.warnings.some((w) => w.includes("crosses itself near (5, 5)"))).toBe(true);
  });
});
