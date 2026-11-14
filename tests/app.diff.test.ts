import { describe, expect, test } from "bun:test";
import { diffDocument, sameNode, summarize } from "../src/viewer/diff";
import { createKernel } from "../src/kernel";
import type { Document, Node } from "../src/ir";

const box = (x: number, y = 10, z = 5): Node => ({ type: "box", size: [x, y, z] });
const doc = (...parts: [string, Node][]): Document => ({ parts: parts.map(([name, node]) => ({ name, node })) });

describe("diff document", () => {
  test("changed parts get new−old and old−new; same parts nothing; new/gone whole", () => {
    const before = doc(["a", box(10)], ["b", box(5)], ["gone", box(3)]);
    const after = doc(["a", box(12)], ["b", box(5)], ["fresh", box(4)]);
    const { document, entries } = diffDocument(before, after);
    expect(entries.map((e) => [e.part, e.status])).toEqual([
      ["a", "changed"],
      ["b", "same"],
      ["fresh", "new"],
      ["gone", "gone"],
    ]);
    const byName = new Map((document.parts ?? []).map((p) => [p.name, p.node]));
    const a = entries[0]!;
    expect(byName.get(a.added!)).toEqual({ type: "difference", children: [box(12), box(10)] });
    expect(byName.get(a.removed!)).toEqual({ type: "difference", children: [box(10), box(12)] });
    expect(byName.get(entries[2]!.added!)).toEqual(box(4));
    expect(byName.get(entries[3]!.removed!)).toEqual(box(3));
    expect(document.parts!.length).toBe(4); // nothing for "b"
  });

  test("structural equality", () => {
    expect(sameNode(box(1), box(1))).toBe(true);
    expect(sameNode(box(1), box(2))).toBe(false);
  });
});

describe("diff with the kernel", () => {
  test("box 10 → 12 along x adds 2 × the 10×5 side face, removes nothing", async () => {
    const k = await createKernel();
    const before = doc(["plate", box(10)]);
    const after = doc(["plate", box(12)]);
    const { document, entries } = diffDocument(before, after);
    const r = await k.evaluate(document, { noMesh: true });
    const results = new Map(r.parts.map((p) => [p.name, p]));
    const stats = async (d: Document) => {
      const e = await k.evaluate(d, { noMesh: true });
      return new Map(e.parts.map((p) => [p.name, { volume: p.volume, bbox: p.bbox }]));
    };
    const [sb, sa] = [await stats(before), await stats(after)];
    const [p] = summarize(entries, results, sb, sa);
    expect(p!.status).toBe("changed");
    expect(p!.addedVolume).toBeCloseTo(2 * 10 * 5, 6);
    expect(p!.removedVolume).toBeCloseTo(0, 6);
    expect(p!.deltaVolume).toBeCloseTo(100, 6);
    expect(p!.deltaSize).toEqual([2, 0, 0]);
    k.dispose();
  }, 30_000);

  test("shrinking removes, and a moved hole both adds and removes", async () => {
    const k = await createKernel();
    const plate = (holeX: number): Node => ({
      type: "difference",
      children: [box(40, 20, 4), { type: "transform", matrix: [1, 0, 0, holeX, 0, 1, 0, 10, 0, 0, 1, -1, 0, 0, 0, 1], children: [{ type: "cylinder", radius: 3, height: 6 }] }],
    });
    const { document, entries } = diffDocument(doc(["p", plate(10)]), doc(["p", plate(30)]));
    const r = await k.evaluate(document, { noMesh: true });
    const res = new Map(r.parts.map((p) => [p.name, p]));
    const [p] = summarize(entries, res, new Map(), new Map());
    const hole = Math.PI * 9 * 4; // the hole's volume inside the 4 mm plate
    expect(p!.addedVolume).toBeCloseTo(hole, 1); // where the hole was is now material
    expect(p!.removedVolume).toBeCloseTo(hole, 1); // where it is now was material
    k.dispose();
  }, 30_000);
});
