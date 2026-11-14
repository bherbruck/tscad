/**
 * Testing a model with tscad/testing: run with `bun test examples/bracket.test.tsx`.
 * Importing "tscad/testing" registers the matchers (toEvaluate, toHaveVolume, toFitIn,
 * toHaveNoInterference, toBePrintable).
 */
import { describe, expect, test } from "bun:test"
import { evaluateModel, paramCombos } from "tscad/testing"
import * as bracket from "./bracket"

describe("bracket", () => {
  test("defaults: evaluates, fits a 60 × 40 × 45 envelope, prints upright", async () => {
    const r = await evaluateModel(bracket)
    expect(r).toEvaluate()
    expect(r).toFitIn([60, 40, 45])
    expect(r).toBePrintable({ minWall: 0.8, bed: [220, 220, 250], maxOverhangFraction: 0.05 })
  }, 60_000)

  test("a thicker bracket is heavier", async () => {
    const thin = await evaluateModel(bracket, { thickness: 4 })
    const thick = await evaluateModel(bracket, { thickness: 8 })
    expect(thick.volume()).toBeGreaterThan(thin.volume())
  }, 60_000)

  // Property test: sample the parameter space (every boolean/choice × latin-hypercube numbers)
  // and check invariants that must hold for every combination.
  test.each(paramCombos(bracket.params, { samples: 2, max: 3, seed: 42 }))("evaluates for %o", async (p) => {
    const r = await evaluateModel(bracket, p)
    expect(r).toEvaluate()
    const [x, y, z] = r.size()
    expect(x).toBeCloseTo(p.width, 3)
    expect(y).toBeCloseTo(p.depth, 3)
    expect(z).toBeCloseTo(p.height, 3)
  }, 60_000)
})
