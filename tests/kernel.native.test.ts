// Native (bun:ffi) and wasm kernels give the same results. Skipped when no native library is
// built (`bun scripts/build-native.ts`).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { KernelPanic, WasmKernelHost } from "../src/kernel/index";
import { loadNativeKernel, nativeLibraryPath } from "../src/kernel/native";
import type { Document } from "../src/ir";

const doc: Document = {
  parts: [
    { name: "plate", node: { type: "fillet", radius: 1, children: [{ type: "difference", children: [
      { type: "box", size: [40, 30, 10], center: true },
      { type: "cylinder", radius: 5, height: 20, center: true },
    ] }] } },
    { name: "ball", node: { type: "sphere", radius: 3 } },
  ],
};

describe.skipIf(!existsSync(nativeLibraryPath()))("native kernel", () => {
  test("matches the wasm kernel", async () => {
    const native = (await loadNativeKernel())!;
    const wasm = await WasmKernelHost.create();
    const [a, b] = [await native.evaluate(doc), await wasm.evaluate(doc)];
    expect(a.ok).toBe(true);
    for (let i = 0; i < a.parts.length; i++) {
      expect(a.parts[i]!.volume!).toBeCloseTo(b.parts[i]!.volume!, 6);
      expect(a.parts[i]!.bbox).toEqual(b.parts[i]!.bbox);
      expect(a.parts[i]!.error).toBeUndefined();
    }
    const [ma, mb] = [(await native.mesh("plate"))!, (await wasm.mesh("plate"))!];
    expect(ma.positions).toEqual(mb.positions);
    expect(ma.indices).toEqual(mb.indices);
    expect(ma.edgeIds).toEqual(mb.edgeIds);
    expect(await native.mesh("nope")).toBeUndefined();
    expect((await native.meshAt("ball", 0.01)).indices.length).toBeGreaterThan(mb.indices.length / 10);
    expect(await native.step(["ball"])).toStartWith("ISO-10303-21");
    expect(await native.pickEdge("plate", 0)).toEqual(await wasm.pickEdge("plate", 0));
    expect(await native.partNames()).toEqual(["ball", "plate"]);
    const again = await native.evaluate(doc);
    expect(again.parts.every((p) => p.cached)).toBe(true);
    await expect(native.pickEdge("nope", 0)).rejects.toThrow("no part named nope");
    expect(KernelPanic).toBeDefined();
    native.dispose();
  });
});
