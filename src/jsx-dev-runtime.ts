/**
 * tscad's development JSX runtime. Uses the compiler-provided `source` when there is one
 * (Babel, esbuild, tsc with `react-jsxdev`), else captures the caller's location from the stack
 * (Bun passes no source).
 */
import { captureSource, Fragment, makeElement, type Key, type TscadElement } from "./core/element";
import type { SourceLoc } from "./core/errors";

export { Fragment };
export type { JSX } from "./jsx-runtime";

/** Where the JSX compiler says an element was written. */
export interface JsxSource {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

/** Create an element, recording where it was written. */
export function jsxDEV(
  type: TscadElement["type"],
  props: Record<string, unknown>,
  key: Key | undefined,
  _isStaticChildren?: boolean,
  source?: JsxSource,
  _self?: unknown,
): TscadElement {
  const loc: SourceLoc | undefined = source?.fileName
    ? { file: source.fileName, line: source.lineNumber, column: source.columnNumber ?? 0 }
    : captureSource();
  return makeElement(type, props, key, loc);
}
