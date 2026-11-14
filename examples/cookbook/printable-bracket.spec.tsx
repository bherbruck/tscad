/**
 * Proves printable-bracket.tsx prints without supports at every size: run with
 * `bun test ./examples/`.
 */
import { expect, test } from "bun:test"
import { evaluateModel, paramCombos } from "tscad/testing"
import * as bracket from "./printable-bracket"

test.each(paramCombos(bracket.params, { method: "corners" }))("printable at %o", async (p) => {
  const r = await evaluateModel(bracket, p)
  expect(r).toEvaluate()
  // overhangs ≤ 45° from vertical, walls ≥ 0.8 mm, fits a 220 mm bed, with no support area at all
  expect(r).toBePrintable({ maxOverhangDeg: 45, minWall: 0.8, bed: [220, 220, 250], maxOverhangFraction: 0 })
}, 60_000)
