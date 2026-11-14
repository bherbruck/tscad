/**
 * Opt-in param-space sweep of every example (slow: minutes). `TSCAD_SWEEP=1 bun test tests/sweep.examples.test.ts`
 * Model failures (a compile error or an empty part) always fail. Kernel failures fail unless the
 * example is listed in KNOWN with a docs/KERNEL_ISSUES.md entry; a known example that now passes
 * every combo is reported so its entry can be dropped.
 */
import { describe, expect, test } from "bun:test";
import { exampleFiles, sweep, type ExampleResult } from "../scripts/sweep-examples";

/** Examples whose remaining sweep failures are kernel bugs (docs/KERNEL_ISSUES.md). */
const KNOWN: Record<string, string> = {
  "spur-gear": "#17 gear root gaps, #18 chamfer limit",
  "cookbook/gear-pair": "#17 gear root gaps",
  enclosure: "#14 PointClassify",
  vase: "#18 shell mass::enclosure",
  "cookbook/name-tag": "#19 glyph t at 1–3 mm",
};
/** Examples owned by the sketch agent whose fixes are in progress. */
const PENDING = new Set(["sketch-on-face", "sketch-vase", "sketch-flange", "sketch-link-arm", "sketch-coat-hook", "sketch-pulley", "converted/enclosure", "converted/box-with-lid", "converted/grid-bin"]);

const label = (f: string) => f.replace(/^.*\/examples\//, "").replace(/\.tsx$/, "");

describe.skipIf(!process.env.TSCAD_SWEEP)("example param sweep", () => {
  let results: ExampleResult[] = [];

  test(
    "every example evaluates across its params",
    async () => {
      results = await sweep(exampleFiles(), { jobs: Number(process.env.TSCAD_SWEEP_JOBS ?? 8), samples: 24, seed: 1 });
      const problems: string[] = [];
      for (const r of results) {
        const name = label(r.file);
        if (r.error) {
          problems.push(`${name}: ${r.error}`);
          continue;
        }
        for (const c of r.combos) {
          if (c.status === "ok" || c.status === "hang") continue;
          const kernel = c.status === "kernel" || c.status === "panic";
          if (PENDING.has(name) || (kernel && KNOWN[name])) continue;
          problems.push(`${name} [${c.status}] ${c.message} ${JSON.stringify(c.params)}`);
        }
      }
      expect(problems).toEqual([]);
    },
    60 * 60_000,
  );

  test("known kernel failures are still failing", () => {
    const fixed = results.filter((r) => KNOWN[label(r.file)] && r.combos.every((c) => c.status === "ok")).map((r) => label(r.file));
    expect(fixed).toEqual([]);
  });
});
