import { beforeAll, describe, expect, test } from "bun:test";
import { compile, renderModule } from "tscad";
import { Board, BoardCase, boards, connectorFace } from "tscad/parts";
import { checkInterference } from "../src/check";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";

const names = Object.keys(boards) as (keyof typeof boards)[];

describe("board data", () => {
  for (const n of names) {
    test(`${n}: holes inside the PCB, side connectors at their edge, ids unique`, () => {
      const b = boards[n];
      const [W, D] = b.size;
      for (const h of b.holes) {
        expect(h.at[0] - h.d / 2).toBeGreaterThan(0);
        expect(h.at[0] + h.d / 2).toBeLessThan(W);
        expect(h.at[1] - h.d / 2).toBeGreaterThan(0);
        expect(h.at[1] + h.d / 2).toBeLessThan(D);
      }
      for (const k of b.connectors) {
        const [x0, y0, x1, y1] = k.rect;
        expect(x1).toBeGreaterThan(x0);
        expect(y1).toBeGreaterThan(y0);
        // a side-facing connector reaches (or overhangs) the edge it faces
        if (k.facing === "-x") expect(x0).toBeLessThanOrEqual(1);
        if (k.facing === "+x") expect(x1).toBeGreaterThanOrEqual(W - 1);
        if (k.facing === "-y") expect(y0).toBeLessThanOrEqual(1);
        if (k.facing === "+y") expect(y1).toBeGreaterThanOrEqual(D - 1);
      }
      expect(new Set(b.connectors.map((k) => k.id)).size).toBe(b.connectors.length);
      expect(b.sources.length).toBeGreaterThan(40);
    });
  }
  test("the Pi 4 and Pi 5 share the outline and holes; the Pi 5 moved the Ethernet jack", () => {
    expect(boards.raspberryPi5.holes).toEqual(boards.raspberryPi4.holes);
    const eth = (b: typeof boards.raspberryPi4) => b.connectors.find((k) => k.id === "ethernet")!;
    expect((eth(boards.raspberryPi5).rect[1] + eth(boards.raspberryPi5).rect[3]) / 2).toBeLessThan(20);
    expect((eth(boards.raspberryPi4).rect[1] + eth(boards.raspberryPi4).rect[3]) / 2).toBeGreaterThan(40);
  });
});

describe("<Board>", () => {
  test("anchors per hole and connector", () => {
    const r = compile(<Board board={boards.raspberryPi5} name="pi" />);
    const ids = r.assembly!.anchors.filter((a) => a.part === "pi-pcb").map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["origin", "hole1", "hole2", "hole3", "hole4", "usbc", "hdmi0", "hdmi1", "ethernet", "gpio"]));
    const usbc = r.assembly!.anchors.find((a) => a.part === "pi-pcb" && a.id === "usbc")!;
    const f = connectorFace(boards.raspberryPi5, boards.raspberryPi5.connectors[0]!);
    expect([usbc.frame[3], usbc.frame[7], usbc.frame[11]].map((v) => +v!.toFixed(9))).toEqual(f.map((v) => +v.toFixed(9)));
  });
});

describe("<BoardCase>", () => {
  let k: KernelHost;
  beforeAll(async () => {
    k = await loadKernel();
  }, 30_000);

  for (const n of names) {
    test(`${n}: every port opening lines up with its connector (≤ 0.01 mm)`, () => {
      const b = boards[n];
      const r = compile(<BoardCase board={b} />);
      const anchors = r.assembly!.anchors;
      const pos = (part: string, id: string) => {
        const a = anchors.find((x) => x.part === part && x.id === id);
        if (!a) throw new Error(`no anchor ${part}.${id}`);
        return [a.frame[3]!, a.frame[7]!, a.frame[11]!];
      };
      let checked = 0;
      for (const c of b.connectors.filter((c) => c.facing !== "+z" && c.facing !== "-z")) {
        const conn = pos("case-board-pcb", c.id), port = pos("case-base", `port-${c.id}`);
        const across = c.facing.endsWith("x") ? [1, 2] : [0, 2];
        for (const i of across) expect(Math.abs(conn[i]! - port[i]!)).toBeLessThanOrEqual(0.01);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  for (const n of ["raspberryPi5", "arduinoUno", "esp32DevKitC"] as const) {
    test(`${n}: the board fits — no interference with the case`, async () => {
      const r = compile(<BoardCase board={boards[n]} />);
      const e = await k.evaluate(r.document, { noMesh: true });
      expect(e.ok).toBe(true);
      // the board against the base and against the lid (base ∩ lid itself trips a kernel gap:
      // "SmFace::PointClassify not supported" for the lid's lip nested in the rim)
      for (const shell of ["case-base", "case-lid"]) {
        const ir = await checkInterference(k, r.document, { restore: false, parts: [shell, "case-board-pcb", "case-board-parts"] });
        expect(ir.errors).toEqual([]);
        expect(ir.pairs).toEqual([]);
        if (shell === "case-base") expect(ir.checked).toBeGreaterThan(0); // the board touches its supports
      }
      // the board sits on the supports, inside the walls
      const pcb = e.parts.find((p) => p.name === "case-board-pcb")!, base = e.parts.find((p) => p.name === "case-base")!;
      for (const i of [0, 1]) {
        expect(pcb.bbox![0][i]!).toBeGreaterThan(base.bbox![0][i]!);
        expect(pcb.bbox![1][i]!).toBeLessThan(base.bbox![1][i]!);
      }
    }, 120_000);
  }

  test("examples/pi5-case-auto.tsx compiles for every board", async () => {
    const mod = await import("../examples/pi5-case-auto.tsx");
    for (const board of names) {
      const r = renderModule(mod, { board });
      expect(r.document.parts!.map((p) => p.name)).toEqual(expect.arrayContaining(["case-base", "case-lid", "case-board-pcb"]));
      expect(r.warnings).toEqual([]);
    }
  });
});
