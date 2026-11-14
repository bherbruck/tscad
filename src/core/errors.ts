/** Where a JSX element was written. */
export interface SourceLoc {
  /** Absolute path or URL of the source file. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column (0 when unknown). */
  column: number;
  /** The element's tag (`box`, `extrude`, ...) when known. */
  tag?: string;
  /** The nearest user component the element was rendered by, when known. */
  component?: string;
}

/** Format a location as `file:line:col`. */
export function formatLoc(loc: SourceLoc | undefined): string {
  if (!loc) return "";
  return `${loc.file}:${loc.line}${loc.column ? `:${loc.column}` : ""}`;
}

/** A modelling error with the JSX source location that caused it. */
export class TscadError extends Error {
  /** Where the offending element was written, when known. */
  readonly loc?: SourceLoc;
  /** IR node path (`parts/0/1`) when the error is about an emitted node. */
  readonly path?: string;
  /** A suggestion for fixing it. */
  readonly hint?: string;
  /** The message without location prefix or hint. */
  readonly detail: string;

  constructor(message: string, opts: { loc?: SourceLoc; path?: string; hint?: string; cause?: unknown } = {}) {
    const where = opts.loc ? `${formatLoc(opts.loc)}: ` : "";
    const tag = opts.loc?.tag && !message.includes(`<${opts.loc.tag}>`) ? `<${opts.loc.tag}> ` : "";
    super(`${where}${tag}${message}${opts.hint ? `\n  hint: ${opts.hint}` : ""}`, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "TscadError";
    this.detail = message;
    if (opts.loc) this.loc = opts.loc;
    if (opts.path) this.path = opts.path;
    if (opts.hint) this.hint = opts.hint;
  }
}
