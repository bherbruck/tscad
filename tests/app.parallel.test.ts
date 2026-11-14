import { afterAll, describe, expect, test } from "bun:test";
import { createParallelKernel, disposeKernelProcesses, ProcessEvaluator, type ParallelKernelHost } from "../src/cli/parallel";
import { KernelPanic } from "../src/kernel";
import type { Document } from "../src/ir";

const doc = (n: number): Document => ({
  parts: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, node: { type: "difference", children: [{ type: "box", size: [10 + i, 10, 10] }, { type: "sphere", radius: 6 }] } as any })),
});

const children = () => Bun.spawnSync(["pgrep", "-f", "kernel-chil[d].ts"]).stdout.toString().trim().split("\n").filter(Boolean).map(Number);

let k: ParallelKernelHost;

afterAll(() => {
  disposeKernelProcesses();
});

describe("parallel kernel processes", () => {
  test("parts spread over processes, results in order, meshes, STEP and picks routed", async () => {
    k = await createParallelKernel(3);
    const r = await k.evaluate(doc(3));
    expect(r.ok).toBe(true);
    expect(r.parts.map((p) => p.name)).toEqual(["p0", "p1", "p2"]);
    expect(k.pool.size).toBe(3);
    for (const p of ["p0", "p1", "p2"]) expect((await k.mesh(p))!.indices.length).toBeGreaterThan(0);
    const step = await k.step();
    expect((step.match(/MANIFOLD_SOLID_BREP/g) ?? []).length).toBe(3);
    const m = (await k.mesh("p2"))!;
    expect((await k.pickFace("p2", m.faceIds[0]!)).kind.length).toBeGreaterThan(0);
    expect((await k.meshAt("p1", 0.05)).positions.length).toBeGreaterThan(0);
  }, 60_000);

  test("a crashed kernel process rejects with KernelPanic and is restarted", async () => {
    const child = k.pool.evaluators.find((e) => e instanceof ProcessEvaluator) as ProcessEvaluator;
    const pending = child.evaluate(doc(1));
    child.crash();
    await expect(pending).rejects.toBeInstanceOf(KernelPanic);
    expect(child.restarts).toBe(1);
    const again = await child.evaluate(doc(1));
    expect(again.result.ok).toBe(true);
  }, 60_000);

  test("dispose leaves no kernel processes behind", async () => {
    expect(children().length).toBeGreaterThan(0);
    k.dispose();
    disposeKernelProcesses();
    for (let i = 0; i < 50 && children().length; i++) await Bun.sleep(100);
    expect(children()).toEqual([]);
  }, 30_000);
});
