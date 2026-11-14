import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { closestOnAxis, frameOf, signedAngle } from "../src/viewer/assembly-overlay";
import { Pool, type Evaluated, type Evaluator } from "../src/viewer/pool";
import type { Document, EvalResult, PartResult } from "../src/ir";
import { renderModule } from "../src";

describe("joint drag math", () => {
  test("frameOf reads axis columns and the origin", () => {
    // x → (0,1,0), y → (-1,0,0), z → (0,0,1), origin (1,2,3)
    const f = frameOf([0, -1, 0, 1, 1, 0, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1]);
    expect(f.x.toArray()).toEqual([0, 1, 0]);
    expect(f.y.toArray()).toEqual([-1, 0, 0]);
    expect(f.o.toArray()).toEqual([1, 2, 3]);
  });

  test("signed angles follow the right-hand rule about the axis", () => {
    const z = new THREE.Vector3(0, 0, 1);
    expect(signedAngle(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), z)).toBeCloseTo(90, 9);
    expect(signedAngle(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), z)).toBeCloseTo(-90, 9);
    expect(signedAngle(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), z.clone().negate())).toBeCloseTo(-90, 9);
  });

  test("closest point on a slider axis to a view ray", () => {
    const ray = new THREE.Ray(new THREE.Vector3(5, -10, 0), new THREE.Vector3(0, 1, 0));
    expect(closestOnAxis(ray, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0))).toBeCloseTo(5, 9);
  });
});

/** A fake kernel: records which parts it was asked for. */
class Fake implements Evaluator {
  calls: string[][] = [];
  constructor(readonly ms = 1) {}
  async evaluate(doc: Document): Promise<Evaluated> {
    const names = (doc.parts ?? []).map((p) => p.name ?? "");
    this.calls.push(names);
    const parts: PartResult[] = names.map((name, i) => ({ name, ok: name !== "bad", empty: false, error: name === "bad" ? { path: `parts/${i}/0`, op: "fillet", message: "x" } : undefined, volume: 1, area: 1, bbox: undefined, counts: undefined, warnings: [], millis: this.ms, cached: false }) as unknown as PartResult);
    const result = { ok: parts.every((p) => p.ok), parts, cacheHits: 1, cacheMisses: 2, cacheSize: 3, millis: 1, frames: new Map() } as EvalResult;
    return { result, meshes: new Map() };
  }
  async pick() {
    return { index: 0, kind: this.calls.length ? "mine" : "?", points: [], direction: undefined, radius: undefined, suggestions: [], smooth: false } as any;
  }
  async meshAt(): Promise<any> {
    return {};
  }
  async step(parts: string[]) {
    return parts.join(",");
  }
  dispose() {}
}

const doc = (...names: string[]): Document => ({ parts: names.map((name) => ({ name, node: { type: "sphere", radius: 1 } })) });

describe("parallel part evaluation pool", () => {
  test("one part stays on the local kernel; several spread out and keep their owner", async () => {
    const local = new Fake();
    const spawned: Fake[] = [];
    const pool = new Pool(local, 3, () => {
      const f = new Fake();
      spawned.push(f);
      return f;
    });
    await pool.evaluate(doc("a"));
    expect(spawned.length).toBe(0);
    const r = await pool.evaluate(doc("a", "b", "c"));
    expect(spawned.length).toBe(2);
    expect(r.result.parts.map((p) => p.name)).toEqual(["a", "b", "c"]);
    expect(r.result.cacheHits).toBe(3);
    const owners = ["a", "b", "c"].map((n) => pool.ownerOf(n));
    expect(new Set(owners).size).toBe(3);
    // Sticky: re-evaluating sends each part to the same kernel (its cache).
    await pool.evaluate(doc("a", "b", "c"));
    expect(["a", "b", "c"].map((n) => pool.ownerOf(n))).toEqual(owners);
    expect(pool.size).toBe(3);
  });

  test("error paths are renumbered to the model's part index", async () => {
    const pool = new Pool(new Fake(), 2, () => new Fake());
    const r = await pool.evaluate(doc("ok1", "bad"));
    expect(r.result.ok).toBe(false);
    expect(r.result.parts[1]!.error!.path).toBe("parts/1/0");
  });

  test("STEP across kernels is rebuilt in one", async () => {
    const local = new Fake();
    const pool = new Pool(local, 2, () => new Fake());
    const d = doc("x", "y");
    await pool.evaluate(d);
    expect(await pool.step(["x", "y"], d)).toBe("x,y");
    expect(local.calls.at(-2)).toEqual(["x", "y"]);
  });
});

describe("assembly data the overlay uses", () => {
  test("mates have anchors at both ends and a drive-able angle", async () => {
    const r = renderModule(await import("../examples/assembly-hinge-box.tsx"));
    const a = r.assembly!;
    for (const m of a.mates) {
      expect(a.anchors.some((x) => `${x.part}.${x.id}` === m.a)).toBe(true);
      expect(a.anchors.some((x) => `${x.part}.${x.id}` === m.b)).toBe(true);
    }
    // Perturbing `open` moves the hinge angle by −1° per degree (angle={-p.open}).
    const r2 = renderModule(await import("../examples/assembly-hinge-box.tsx"), { open: (r.values as any).open + 1 });
    expect(r2.assembly!.mates[0]!.angle! - a.mates[0]!.angle!).toBeCloseTo(-1, 9);
  });
});

import { ramp, thinSeverity } from "../src/viewer/check-overlay";

describe("check heatmap colours", () => {
  test("thin-wall severity: 1 at or under the minimum, 0 from twice it, 0 when no wall was found", () => {
    expect(thinSeverity(0.5, 0.8)).toBe(1);
    expect(thinSeverity(0.8, 0.8)).toBe(1);
    expect(thinSeverity(1.2, 0.8)).toBeCloseTo(0.5, 9);
    expect(thinSeverity(2, 0.8)).toBe(0);
    expect(thinSeverity(Infinity, 0.8)).toBe(0);
  });
  test("ramp goes yellow → red", () => {
    const lo = ramp(0), hi = ramp(1);
    expect(lo.g).toBeGreaterThan(hi.g);
    expect(hi.r).toBeGreaterThan(0.9);
  });
});
