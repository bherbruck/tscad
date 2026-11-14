/**
 * Release smoke test (slow, needs the network/bun cache): pack → install → init → build → info →
 * import every subpath. Opt in with `TSCAD_PACK_TEST=1 bun test tests/pack`.
 */
import { expect, test } from "bun:test";
import { packCheck } from "../scripts/pack-check";

test.skipIf(process.env.TSCAD_PACK_TEST !== "1")(
  "the packed tarball installs and works",
  async () => {
    const r = await packCheck({ log: () => {} });
    for (const s of r.steps) expect({ step: s.name, ok: s.ok, detail: s.ok ? "" : s.detail }).toEqual({ step: s.name, ok: true, detail: "" });
    expect(r.ok).toBe(true);
    // the wasm dominates; keep an eye on it (a release wasm build is much smaller than a dev one)
    expect(r.size).toBeLessThan(40e6);
  },
  300_000,
);
