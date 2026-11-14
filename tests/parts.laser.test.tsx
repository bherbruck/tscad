import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "tscad";
import { FingerJointBox, fingerBoxPanels, LivingHinge } from "tscad/parts";
import { cutOutline } from "../src/parts/laser";
import { checkInterference } from "../src/check";
import { toDXF } from "../src/drawing";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";
import { polyline, signedArea } from "../src/core/sketch/seg";

const area = (pts: [number, number][]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i]![0] * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * pts[i]![1];
  return a / 2;
};

/** DXF group pairs → entities. */
function entities(dxf: string) {
  const l = dxf.trimEnd().split("\n");
  const out: { type: string; g: Map<number, string[]> }[] = [];
  let inEnt = false;
  for (let i = 0; i < l.length; i += 2) {
    const c = Number(l[i]), v = l[i + 1]!.trim();
    if (c === 2 && v === "ENTITIES") inEnt = true;
    else if (inEnt && c === 0) {
      if (v === "ENDSEC") break;
      out.push({ type: v, g: new Map() });
    } else if (inEnt && out.length) (out[out.length - 1]!.g.get(c) ?? out[out.length - 1]!.g.set(c, []).get(c)!).push(v);
  }
  return out;
}

describe("cutOutline", () => {
  test("notches cut the outline; slots become CW holes", () => {
    const one = cutOutline(10, 6, [[3, 0, 5, 1]]);
    expect(one.length).toBe(1);
    expect(one[0]!.length).toBe(8);
    expect(area(one[0]!)).toBeCloseTo(60 - 2, 9);
    const slot = cutOutline(10, 6, [[4, 2, 6, 4]]);
    expect(slot.length).toBe(2);
    expect(slot.map(area).sort((a, b) => a - b)).toEqual([-4, 60]);
  });
});

describe("FingerJointBox", () => {
  let k: KernelHost;
  beforeAll(async () => {
    k = await loadKernel();
  }, 30_000);

  test("panels fill exactly the box walls and nothing collides (kerf 0)", async () => {
    const W = 100, D = 70, H = 50, t = 3;
    const r = compile(<FingerJointBox width={W} depth={D} height={H} thickness={t} lid dividers={2} assembled />);
    expect(r.document.parts!.map((p) => p.name)).toEqual(["box-bottom", "box-front", "box-back", "box-left", "box-right", "box-lid", "box-divider1", "box-divider2"]);
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.ok).toBe(true);
    // a closed shell with no gaps, plus two dividers spanning the cavity (their tabs fill the slots)
    const total = e.parts.reduce((s, p) => s + p.volume!, 0);
    expect(total).toBeCloseTo(W * D * H - (W - 2 * t) * (D - 2 * t) * (H - 2 * t) + 2 * (D - 2 * t) * (H - 2 * t) * t, 3);
    for (const p of e.parts) {
      expect(p.bbox![0].every((v) => v > -1e-6)).toBe(true);
      expect(p.bbox![1][0]).toBeLessThanOrEqual(W + 1e-6);
      expect(p.bbox![1][1]).toBeLessThanOrEqual(D + 1e-6);
      expect(p.bbox![1][2]).toBeLessThanOrEqual(H + 1e-6);
    }
    const ir = await checkInterference(k, r.document, { restore: false });
    expect(ir.errors).toEqual([]);
    expect(ir.pairs).toEqual([]);
    expect(ir.checked).toBeGreaterThan(10); // the panels touch along every joint
  }, 120_000);

  test("open box: the four walls and bottom", async () => {
    const r = compile(<FingerJointBox width={60} depth={40} height={30} thickness={3} assembled labels={false} />);
    const e = await k.evaluate(r.document, { noMesh: true });
    expect(e.parts.reduce((s, p) => s + p.volume!, 0)).toBeCloseTo(60 * 40 * 30 - 54 * 34 * 27, 3);
  }, 60_000);

  test("flat layout: drawings per panel with labels; kerf grows every outline", () => {
    const flat = compile(<FingerJointBox width={100} depth={70} height={50} thickness={3} lid />);
    const cut = flat.drawings.filter((d) => d.layer === "cut");
    expect(cut.map((d) => d.name)).toEqual(["box-bottom", "box-front", "box-back", "box-left", "box-right", "box-lid"]);
    expect(flat.drawings.filter((d) => d.layer === "engrave").length).toBe(6);
    // flat drawings carry thickness, so they're parts too (the viewer shows the sheet)
    expect(flat.document.parts!.length).toBe(6);
    const kerfed = compile(<FingerJointBox width={100} depth={70} height={50} thickness={3} lid kerf={0.2} />);
    const a0 = Math.abs(signedArea(polyline(cut[0]!.loops[0]!)));
    const outline = kerfed.drawings.find((d) => d.name === "box-bottom")!.loops[0]!;
    const a1 = Math.abs(signedArea(polyline(outline)));
    expect(a1).toBeGreaterThan(a0);
    // panels don't overlap in the flat layout
    const boxes = cut.map((d) => {
      const pts = d.loops.flatMap((l) => polyline(l));
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] as [number, number, number, number];
    });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true);
      }
  });

  test("DXF: CUT and ENGRAVE layers, every cut contour closed", () => {
    const r = compile(<FingerJointBox width={100} depth={70} height={50} thickness={3} lid dividers={1} />);
    const ents = entities(toDXF(r.drawings));
    const lines = ents.filter((e) => e.type === "LINE" && e.g.get(8)![0] === "CUT");
    expect(new Set(ents.map((e) => e.g.get(8)?.[0]).filter(Boolean))).toEqual(new Set(["CUT", "ENGRAVE"]));
    // panels are all straight lines (no curves to cut)
    expect(ents.filter((e) => e.g.get(8)?.[0] === "CUT" && e.type !== "LINE")).toEqual([]);
    // every endpoint is shared by exactly two lines: closed contours
    const deg = new Map<string, number>();
    for (const e of lines)
      for (const [x, y] of [[10, 20], [11, 21]] as const) {
        const key = `${(+e.g.get(x)![0]!).toFixed(4)},${(+e.g.get(y)![0]!).toFixed(4)}`;
        deg.set(key, (deg.get(key) ?? 0) + 1);
      }
    expect([...deg.values()].every((d) => d === 2)).toBe(true);
    expect(ents.some((e) => e.type === "POLYLINE" && e.g.get(8)![0] === "ENGRAVE")).toBe(true);
  });

  test("bad input", () => {
    expect(() => compile(<FingerJointBox width={10} depth={70} height={50} thickness={3} />)).toThrow(/at least 4 × thickness/);
    expect(() => compile(<FingerJointBox width={100} depth={70} height={50} thickness={3} kerf={5} />)).toThrow(/kerf/);
  });

  test("fingerBoxPanels: an odd number of fingers per edge", () => {
    const ps = fingerBoxPanels({ W: 100, D: 70, H: 50, t: 3, finger: 9, lid: false, dividers: 0 });
    const bottom = ps.find((p) => p.name === "bottom")!;
    // the bottom keeps its corners (highest priority) and has notches on all four edges
    expect(bottom.loops.length).toBe(1);
    expect(bottom.loops[0]!).toContainEqual([0, 0]);
    const front = ps.find((p) => p.name === "front")!;
    expect(front.loops[0]!).not.toContainEqual([0, 0]); // its bottom corners are the bottom's
  });
});

describe("LivingHinge", () => {
  test("staggered slots inside the area, as holes", () => {
    const r = compile(
      <drawing name="tag">
        <rect w={80} h={30} />
        <LivingHinge width={24} height={26} />
      </drawing>,
    );
    const loops = r.drawings[0]!.loops;
    const holes = loops.filter((l) => signedArea(polyline(l)) < 0);
    expect(holes.length).toBe(loops.length - 1);
    expect(holes.length).toBeGreaterThan(20);
    for (const h of holes)
      for (const [x, y] of polyline(h)) {
        expect(Math.abs(x)).toBeLessThanOrEqual(12 + 1e-9);
        expect(Math.abs(y)).toBeLessThanOrEqual(13 + 1e-9);
      }
  });
});

describe("example", () => {
  test("tscad build examples/laser-box.tsx -o box.dxf", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tscad-laser-"));
    try {
      const out = join(dir, "box.dxf");
      const p = Bun.spawn(["bun", "src/cli/index.ts", "build", "examples/laser-box.tsx", "-o", out], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
      expect(await p.exited).toBe(0);
      const ents = entities(readFileSync(out, "utf8"));
      expect(ents.filter((e) => e.type === "LINE").length).toBeGreaterThan(300);
      expect(new Set(ents.map((e) => e.g.get(8)?.[0]))).toEqual(new Set(["CUT", "ENGRAVE"]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000); // spawns the CLI; slow under a full parallel test run
});
