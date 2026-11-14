/**
 * `tscad/testing`: test your models with bun:test. Importing it registers the matchers
 * (`toEvaluate`, `toHaveVolume`, `toFitIn`, `toHaveNoInterference`, `toBePrintable`).
 *
 * @example
 * import { expect, test } from "bun:test"
 * import { evaluateModel, paramCombos } from "tscad/testing"
 * import * as bracket from "./bracket"
 *
 * test.each(paramCombos(bracket.params, { samples: 3 }))("bracket %o", async (p) => {
 *   const r = await evaluateModel(bracket, p)
 *   expect(r).toEvaluate()
 *   expect(r).toFitIn([200, 200, 200])
 * })
 */
export { evaluateModel, ModelResult, type EvaluateOptions, type ModelInput } from "./model";
export { forEachParamCombo, paramCombos, type ComboOptions } from "./params";
export { matchers, type PrintableOptions } from "./matchers";
