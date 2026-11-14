import { beforeAll, describe, expect, test } from "bun:test";
import { compile } from "tscad";
import {
  Bearing, bearings, Bolt, boltHeads, clearance, DowelPin, flatWashers, metric, Nut, nylocHeight, SetScrew, ShaftCollar,
  shaftCollars, springWashers, Washer, type MetricSize,
} from "tscad/parts";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

let k: KernelHost;
beforeAll(async () => {
  k = await loadKernel();
});

async function volume(el: any): Promise<number> {
  const { document } = compile(<part name="p">{el}</part>);
  const r = await k.evaluate(document, { noMesh: true });
  const p = r.parts[0]!;
  if (!p.ok) throw new Error(`${p.error?.op}: ${p.error?.message}`);
  return p.volume!;
}

const PI = Math.PI;
const cyl = (r: number, h: number) => PI * r * r * h;
const hexArea = (af: number) => (Math.sqrt(3) / 2) * af * af;
/** volume of a 45° chamfer ring of leg c on a cylinder edge of radius r */
const chamfer45 = (r: number, c: number) => PI * c * c * (r - c / 3);

describe("data tables", () => {
  const sizes = Object.keys(metric) as MetricSize[];
  test("heads are wider than the thread; sockets fit inside heads", () => {
    for (const s of sizes)
      for (const [style, rows] of Object.entries(boltHeads)) {
        const h = rows[s];
        expect(h.dk).toBeGreaterThan(metric[s].d);
        if (h.s > 0) expect(h.s).toBeLessThan(style === "flat" ? metric[s].d : h.dk * 0.8);
        if (h.s > 0) expect(h.t).toBeLessThan(style === "flat" ? h.k + metric[s].d : h.k);
      }
  });
  test("washers clear their bolt; nyloc nuts are taller than plain ones", () => {
    for (const s of sizes) {
      expect(flatWashers[s].d1).toBeGreaterThan(metric[s].d);
      expect(springWashers[s].d1).toBeGreaterThan(metric[s].d);
      expect(nylocHeight[s]).toBeGreaterThan(metric[s].nut.height);
    }
  });
  test("clearance() follows ISO 273", () => {
    expect(clearance("M3")).toBe(3.4);
    expect(clearance("M3", "close")).toBe(3.2);
    expect(clearance("M8", "loose")).toBe(10);
  });
  test("bearing and collar tables are consistent", () => {
    for (const b of Object.values(bearings)) expect(b.D).toBeGreaterThan(b.d);
    expect(bearings["608"]).toEqual({ d: 8, D: 22, B: 7 });
    for (const [bore, c] of Object.entries(shaftCollars)) expect((c.D - Number(bore)) / 2).toBeGreaterThanOrEqual(metric[c.screw].tapDrill); // the set screw gets a full wall of thread
  });
});

describe("volumes against hand calculations", () => {
  test("flat washer M4 (ISO 7089: 4.3 × 9 × 0.8) is an exact annulus", async () => {
    const w = flatWashers.M4;
    expect(await volume(<Washer thread="M4" />)).toBeCloseTo(cyl(w.d2 / 2, w.h) - cyl(w.d1 / 2, w.h), 3);
  });

  test("spring washer M4 is the annulus less its split", async () => {
    const w = springWashers.M4;
    const ring = cyl(w.d2 / 2, w.h) - cyl(w.d1 / 2, w.h);
    const v = await volume(<Washer thread="M4" type="spring" />);
    expect(v).toBeLessThan(ring);
    expect(v).toBeGreaterThan(ring * 0.9);
  });

  test("dowel pin 4 × 20: cylinder less two 45° end chamfers", async () => {
    const c = 0.1 * 4 + 0.1;
    expect(await volume(<DowelPin d={4} length={20} />)).toBeCloseTo(cyl(2, 20) - 2 * chamfer45(2, c), 2);
  });

  test("socket head cap screw M3 × 10 (ISO 4762)", async () => {
    const h = boltHeads.socket.M3;
    const e = Math.min(0.1 * h.k, 0.5);
    const head = cyl(h.dk / 2, h.k) - chamfer45(h.dk / 2, e) - hexArea(h.s) * h.t;
    const c = Math.min(0.5, 0.75);
    const shank = cyl(1.5, 10) - chamfer45(1.5, c);
    expect(await volume(<Bolt thread="M3" length={10} />)).toBeCloseTo(head + shank, 1);
  });

  test("countersunk screw M5 × 16 (ISO 10642): cone head, overall length", async () => {
    const h = boltHeads.flat.M5;
    const cone = (PI * h.k * (2.5 * 2.5 + 2.5 * (h.dk / 2) + (h.dk / 2) ** 2)) / 3;
    const shank = cyl(2.5, 16 - h.k) - chamfer45(2.5, 0.8);
    const v = await volume(<Bolt thread="M5" length={16} head="flat" />);
    expect(v).toBeCloseTo(cone + shank - hexArea(h.s) * h.t, 0);
  });

  test("hex nut M3 (ISO 4032): hex prism less bore, within its chamfers", async () => {
    const n = metric.M3.nut;
    const full = hexArea(n.af) * n.height - cyl(1.5, n.height);
    const v = await volume(<Nut thread="M3" />);
    expect(v).toBeLessThan(full);
    expect(v).toBeGreaterThan(full * 0.9);
  });

  test("nyloc nut M6 is taller (ISO 10511) and heavier than the plain nut", async () => {
    const plain = await volume(<Nut thread="M6" />);
    const nyloc = await volume(<Nut thread="M6" type="nyloc" />);
    expect(nyloc).toBeGreaterThan(plain);
  });

  test("608 bearing: about the 8 × 22 × 7 annulus, less its shield recesses", async () => {
    const full = cyl(11, 7) - cyl(4, 7);
    const v = await volume(<Bearing designation="608" />);
    expect(v).toBeLessThan(full);
    expect(v).toBeGreaterThan(full * 0.95);
  });

  test("shaft collar 8: ring less the set-screw hole", async () => {
    const c = shaftCollars[8];
    const ring = cyl(c.D / 2, c.w) - cyl(4, c.w);
    const v = await volume(<ShaftCollar bore={8} />);
    expect(v).toBeLessThan(ring);
    expect(v).toBeGreaterThan(ring * 0.93);
  });

  test("set screw M4 × 6: cylinder less chamfers and socket", async () => {
    const v = await volume(<SetScrew thread="M4" length={6} />);
    expect(v).toBeLessThan(cyl(2, 6));
    expect(v).toBeGreaterThan(cyl(2, 6) * 0.85);
  });
});

describe("every head style and the cutter", () => {
  for (const head of ["socket", "hex", "button", "flat", "pan"] as const) {
    test(`M4 × 12 ${head}: a solid; its cutter is larger and contains it`, async () => {
      const bolt = await volume(<Bolt thread="M4" length={12} head={head} />);
      const cutter = await volume(<Bolt thread="M4" length={12} head={head} cutter ghost={false} />);
      expect(bolt).toBeGreaterThan(cyl(2, 12) * 0.9);
      expect(cutter).toBeGreaterThan(bolt);
      // the bolt lies inside its own cutter: bolt − cutter is empty
      const { document } = compile(
        <part name="p">
          <difference>
            <Bolt thread="M4" length={12} head={head} />
            <Bolt thread="M4" length={12} head={head} cutter />
          </difference>
        </part>,
      );
      const r = await k.evaluate(document, { noMesh: true });
      expect(r.parts[0]!.ok).toBe(true);
      expect(r.parts[0]!.empty || (r.parts[0]!.volume ?? 0) < 1e-6).toBe(true);
    });
  }

  test("a bolt through a plate with its cutter: the plate keeps its volume less the hole", async () => {
    const plate = 30 * 30 * 6;
    const v = await volume(
      <difference>
        <box size={[30, 30, 6]} />
        <Bolt thread="M3" length={10} cutter="close" z={6} />
      </difference>,
    );
    expect(v).toBeCloseTo(plate - cyl(clearance("M3", "close") / 2, 6), 2);
  });

  test("anchors are opt-in, and a prefix keeps several in one part unique", () => {
    const anchors = (el: any) => compile(<part name="p">{el}</part>).assembly?.anchors?.map((a: any) => a.id) ?? [];
    expect(anchors(<Bolt thread="M3" length={10} />)).toEqual([]);
    expect(anchors(<Bolt thread="M3" length={10} anchors />)).toEqual(["head", "tip"]);
    expect(anchors(<><Nut thread="M3" anchors="a-" /><Nut thread="M3" anchors="b-" x={10} /></>)).toEqual(["a-face", "a-top", "b-face", "b-top"]);
  });

  test("bad input is refused with a clear message", () => {
    expect(() => compile(<Bolt thread="M3" length={-1} />)).toThrow(/length/);
    expect(() => compile(<Bolt thread="M3" length={1} head="flat" />)).toThrow(/head height/);
    expect(() => compile(<Bearing designation={"999" as any} />)).toThrow(/unknown designation/);
  });
});

describe("refs into fasteners", () => {
  test("a named bolt's shank cuts a plate; the head stays", async () => {
    const h = boltHeads.socket.M3;
    const v = await volume(
      <>
        <box name="plate" size={[40, 20, 4]} />
        <Bolt name="b" thread="M3" length={12} z={4} />
        <subtract from=".plate" tool=".b > .shank" />
      </>,
    );
    const head = cyl(h.dk / 2, h.k) - chamfer45(h.dk / 2, Math.min(0.1 * h.k, 0.5)) - hexArea(h.s) * h.t;
    expect(v).toBeCloseTo(40 * 20 * 4 - cyl(1.5, 4) + head, 0);
  });

  test("a bolt's clearance cutter is a ref target too", async () => {
    const v = await volume(
      <>
        <box name="plate" size={[40, 20, 4]} />
        <Bolt name="c" thread="M3" length={12} z={4} cutter />
        <subtract from=".plate" tool=".c > .clearance" />
      </>,
    );
    expect(v).toBeCloseTo(40 * 20 * 4 - cyl(clearance("M3") / 2, 4), 1);
  });

  test("an unused cutter is a ghost: dropped from the output", async () => {
    const { document } = compile(
      <part name="p">
        <box size={[10, 10, 10]} />
        <Bolt thread="M3" length={12} z={10} cutter />
      </part>,
    );
    const r = await k.evaluate(document, { noMesh: true });
    expect(r.parts[0]!.volume).toBeCloseTo(1000, 3);
  });
});
