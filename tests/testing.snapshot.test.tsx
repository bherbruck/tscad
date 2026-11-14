import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePNG, encodePNG } from "../src/render";
import { diffImages, evaluateModel, matchRenderSnapshot } from "../src/testing";

const dir = mkdtempSync(join(tmpdir(), "tscad-snap-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const box = (size: number) => (
  <part name="box">
    <box size={size} />
  </part>
);

describe("render snapshot helpers", () => {
  test("PNG decode is the inverse of encode", () => {
    const px = new Uint8Array(5 * 3 * 3).map((_, i) => (i * 37) % 256);
    const img = decodePNG(encodePNG(px, 5, 3, 3));
    expect([img.width, img.height]).toEqual([5, 3]);
    for (let i = 0; i < 15; i++) expect([...img.data.subarray(i * 4, i * 4 + 4)]).toEqual([px[i * 3]!, px[i * 3 + 1]!, px[i * 3 + 2]!, 255]);
  });

  test("diffImages counts pixels over the tolerance", () => {
    const a = { width: 2, height: 1, data: new Uint8Array([10, 10, 10, 255, 10, 10, 10, 255]) };
    const b = { width: 2, height: 1, data: new Uint8Array([20, 10, 10, 255, 90, 10, 10, 255]) };
    const d = diffImages(a, b, 24);
    expect(d.diffPixels).toBe(1);
    expect(d.diffRatio).toBe(0.5);
    expect(d.maxDelta).toBe(80);
  });

  test("writes a missing snapshot, matches it, and writes a diff on a change", async () => {
    const saved = process.env.CI;
    delete process.env.CI;
    try {
      const first = await matchRenderSnapshot(await evaluateModel(box(10)), { name: "box", dir });
      expect(first.written).toBe(true);
      expect(existsSync(join(dir, "box.iso.png"))).toBe(true);
      // the same model: passes and leaves the file alone
      const before = readFileSync(join(dir, "box.iso.png"));
      await expect(await evaluateModel(box(10))).toMatchRenderSnapshot({ name: "box", dir });
      expect(readFileSync(join(dir, "box.iso.png"))).toEqual(before);
      // a different shape (a long bar fills the frame differently): fails with a diff image
      const changed = await matchRenderSnapshot(<part name="box"><box size={[40, 4, 4]} /></part>, { name: "box", dir });
      expect(changed.pass).toBe(false);
      expect(changed.diffPath).toBe(join(dir, "box.iso.diff.png"));
      expect(existsSync(changed.diffPath!)).toBe(true);
      expect(changed.message).toContain("TSCAD_UPDATE_SNAPSHOTS=1");
      // update rewrites it and removes the stale diff
      const updated = await matchRenderSnapshot(<part name="box"><box size={[40, 4, 4]} /></part>, { name: "box", dir, update: true });
      expect(updated.written).toBe(true);
      expect(existsSync(join(dir, "box.iso.diff.png"))).toBe(false);
    } finally {
      if (saved !== undefined) process.env.CI = saved;
    }
  }, 60_000);

  test("under CI a missing snapshot fails instead of being written", async () => {
    const saved = process.env.CI;
    process.env.CI = "true";
    try {
      const r = await matchRenderSnapshot(box(10), { name: "never-written", dir });
      expect(r.pass).toBe(false);
      expect(r.message).toContain("CI");
      expect(existsSync(join(dir, "never-written.iso.png"))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.CI;
      else process.env.CI = saved;
    }
  }, 60_000);

  test("a model with nothing to render fails with a reason", async () => {
    const r = await matchRenderSnapshot(<part name="x"><difference><box size={1} /><box size={2} /></difference></part>, { name: "empty", dir });
    expect(r.pass).toBe(false);
    expect(r.message.length).toBeGreaterThan(5);
  }, 60_000);

  test("snapshot PNGs stay small", () => {
    const sizes = [...new Bun.Glob("*.png").scanSync(join(import.meta.dir, "__snapshots__"))].map((f) => Bun.file(join(import.meta.dir, "__snapshots__", f)).size);
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThan(40_000);
  });
});
