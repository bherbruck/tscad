/** bun:test matchers for tscad models (registered by importing `tscad/testing`). */
import { expect } from "bun:test";
import type { PrintabilityOptions } from "../check/printability";
import { ModelResult } from "./model";

export interface PrintableOptions extends PrintabilityOptions {
  /** Largest allowed overhang share of the surface. Default 0.05 (5 %). */
  maxOverhangFraction?: number;
  /** Largest allowed share of the surface thinner than `minWall`. Default 0.005. */
  maxThinFraction?: number;
  /** Require a watertight mesh. Default true. */
  watertight?: boolean;
}

declare module "bun:test" {
  interface Matchers<T> {
    /** The model compiled and every part evaluated without a kernel error. */
    toEvaluate(): void;
    /** Total volume (or `part`'s) is `volume` mm³ within `tolerance` (relative if < 1, default 1e-3). */
    toHaveVolume(volume: number, tolerance?: number, part?: string): void;
    /** The model's bounds fit inside `[x, y, z]` mm. */
    toFitIn(size: [number, number, number]): void;
    /** No two parts share volume (async: `await expect(r).toHaveNoInterference()`). */
    toHaveNoInterference(minVolume?: number): Promise<void>;
    /** Every part passes the printability checks. */
    toBePrintable(options?: PrintableOptions): void;
  }
}

function asModel(x: unknown, name: string): ModelResult {
  if (!(x instanceof ModelResult)) throw new TypeError(`${name}: expected the result of evaluateModel(), got ${typeof x}`);
  return x;
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(1) : n.toPrecision(4));

export const matchers = {
  toEvaluate(received: unknown) {
    const r = asModel(received, "toEvaluate");
    return {
      pass: r.ok,
      message: () => (r.ok ? `expected the model to fail, but all ${r.parts.length} part(s) evaluated` : `expected the model to evaluate: ${r.describeErrors() || "no parts"}`),
    };
  },
  toHaveVolume(received: unknown, volume: number, tolerance = 1e-3, part?: string) {
    const r = asModel(received, "toHaveVolume");
    const v = r.volume(part);
    const tol = tolerance < 1 ? Math.abs(volume) * tolerance : tolerance;
    const pass = r.ok && Math.abs(v - volume) <= tol;
    return { pass, message: () => `expected ${part ? `part "${part}"` : "the model"} ${pass ? "not " : ""}to have volume ${fmt(volume)} ± ${fmt(tol)} mm³, got ${fmt(v)} mm³${r.ok ? "" : ` (${r.describeErrors()})`}` };
  },
  toFitIn(received: unknown, size: [number, number, number]) {
    const r = asModel(received, "toFitIn");
    const s = r.size();
    const pass = r.ok && s.every((v, i) => v <= size[i]! + 1e-9);
    return { pass, message: () => `expected the model (${s.map(fmt).join(" × ")} mm) ${pass ? "not " : ""}to fit in ${size.join(" × ")} mm` };
  },
  async toHaveNoInterference(received: unknown, minVolume?: number) {
    const r = asModel(received, "toHaveNoInterference");
    const res = await r.interference(minVolume !== undefined ? { minVolume } : undefined);
    return {
      pass: res.ok,
      message: () =>
        res.ok
          ? `expected parts to interfere, but none of ${res.checked + res.skipped} pair(s) do`
          : `expected no interference, got ${[...res.pairs.map((p) => `${p.a} ∩ ${p.b} = ${fmt(p.volume)} mm³`), ...res.errors.map((e) => `${e.a} ∩ ${e.b}: ${e.message}`)].join(", ")}`,
    };
  },
  toBePrintable(received: unknown, options: PrintableOptions = {}) {
    const r = asModel(received, "toBePrintable");
    const problems: string[] = [];
    if (!r.ok) problems.push(r.describeErrors());
    for (const [name, p] of r.printability(options)) {
      if (p.overhang.fraction > (options.maxOverhangFraction ?? 0.05)) problems.push(`${name}: ${(p.overhang.fraction * 100).toFixed(1)} % overhangs (${fmt(p.overhang.area)} mm²)`);
      if (p.thickness && p.thickness.thinFraction > (options.maxThinFraction ?? 0.005)) problems.push(`${name}: ${(p.thickness.thinFraction * 100).toFixed(1)} % of the surface thinner than ${options.minWall ?? 0.8} mm (min ${fmt(p.thickness.min)})`);
      if (p.bed && !p.bed.fits) problems.push(`${name}: ${p.size.map(fmt).join(" × ")} mm doesn't fit the bed`);
    }
    if (options.watertight !== false) for (const [name, w] of r.watertight()) if (!w.watertight) problems.push(`${name}: mesh not watertight (${w.boundaryEdges} open, ${w.nonManifoldEdges} non-manifold edges)`);
    return { pass: problems.length === 0, message: () => (problems.length ? `expected the model to be printable:\n  ${problems.join("\n  ")}` : "expected the model not to be printable") };
  },
};

expect.extend(matchers);
