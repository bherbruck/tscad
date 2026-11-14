/**
 * Edge and face selectors: a chainable builder (`edges.top().circles()`), CadQuery-style
 * strings (`">Z or |Z"`), or raw IR `Selector` objects.
 */
import type { Axis, Selector } from "../ir";
import type { Vec3 } from "./math";

/** Anything a `edges=` / `open=` prop accepts. */
export type SelectorLike = Sel | SelectorString | Selector;
/**
 * A CadQuery-style selector string:
 * - `">Z"` at the max Z (top), `"<Z"` at the min Z (bottom)
 * - `"|Z"` parallel to Z (edges: straight vertical edges; faces: faces whose normal is ±Z)
 * - `"#Z"` perpendicular to Z (edges: circles about Z; faces: faces whose normal is square to Z)
 * - `"*"` everything; combine with `and`, `or`, `not` and parentheses: `">Z or |Z"`, `"not <Z"`.
 */
export type SelectorString = string & {};

/** What a selector picks from. Only documentation: the IR is the same for both. */
export type SelectKind = "edges" | "faces";

/** A chainable selector. Each filter method ANDs with what came before. */
export class Sel {
  /** @internal */
  constructor(
    readonly kind: SelectKind,
    /** The IR selector so far (`undefined` = everything). */
    readonly ir: Selector | undefined,
  ) {}

  #with(s: Selector): Sel {
    return new Sel(this.kind, this.ir ? flatAnd(this.ir, s) : s);
  }

  /** Everything (no filter). */
  all(): Sel {
    return new Sel(this.kind, { type: "all" });
  }
  /** Nothing, e.g. `shell` with no open faces. */
  none(): Sel {
    return new Sel(this.kind, { type: "none" });
  }
  /** Lying wholly at the body's top (max Z). Same as `">Z"`. */
  top(): Sel {
    return this.#with({ type: "max", axis: "z" });
  }
  /** Lying wholly at the body's bottom (min Z). Same as `"<Z"`. */
  bottom(): Sel {
    return this.#with({ type: "min", axis: "z" });
  }
  /** Edges: straight edges parallel to Z. Faces: faces whose normal is ±Z. Same as `"|Z"`. */
  vertical(): Sel {
    return this.#with({ type: "parallel", axis: "z" });
  }
  /** Edges: circles about `axis` (default Z). Same as `"#Z"`. */
  circles(axis: Axis = "z"): Sel {
    return this.#with({ type: "perpendicular", axis });
  }
  /** Edges: circles of this radius. */
  radius(r: number): Sel {
    return this.#with({ type: "radius", radius: r });
  }
  /** Edges: straight, along `axis`. Faces: planar with normal ±`axis`. */
  parallel(axis: Axis): Sel {
    return this.#with({ type: "parallel", axis });
  }
  /** Edges: circles about `axis`. Faces: planar with normal square to `axis`. */
  perpendicular(axis: Axis): Sel {
    return this.#with({ type: "perpendicular", axis });
  }
  /** Lying wholly at the body's largest coordinate along `axis`. */
  max(axis: Axis): Sel {
    return this.#with({ type: "max", axis });
  }
  /** Lying wholly at the body's smallest coordinate along `axis`. */
  min(axis: Axis): Sel {
    return this.#with({ type: "min", axis });
  }
  /** Whose sample points all lie inside the box `min`..`max`. */
  within(min: Vec3, max: Vec3): Sel {
    return this.#with({ type: "within", min: [...min], max: [...max] });
  }
  /** By record index (from the viewer's pick panel). Fragile: indices change with the model. */
  index(...indices: (number | number[])[]): Sel {
    return this.#with({ type: "index", indices: indices.flat() });
  }
  /** In this selection and in `other`. */
  and(other: SelectorLike): Sel {
    return this.#with(toSelector(other, this.kind));
  }
  /** In this selection or in `other`. */
  or(other: SelectorLike): Sel {
    const o = toSelector(other, this.kind);
    const a = this.ir ?? { type: "all" };
    const of = [...(a.type === "or" ? a.of : [a]), ...(o.type === "or" ? o.of : [o])];
    return new Sel(this.kind, { type: "or", of });
  }
  /** Everything not in this selection. */
  not(): Sel {
    return new Sel(this.kind, { type: "not", of: this.ir ?? { type: "all" } });
  }
  /** The IR selector. */
  toIR(): Selector {
    return this.ir ?? { type: "all" };
  }
  toJSON(): Selector {
    return this.toIR();
  }
}

function flatAnd(a: Selector, b: Selector): Selector {
  const of = [...(a.type === "and" ? a.of : [a]), ...(b.type === "and" ? b.of : [b])];
  return { type: "and", of };
}

/**
 * Edge selectors.
 * @example <fillet radius={2} edges={edges.top()}>...</fillet>
 * @example <fillet radius={1} edges={edges.vertical().or(edges.circles())}>...</fillet>
 */
export const edges: Sel = new Sel("edges", undefined);
/**
 * Face selectors.
 * @example <shell thickness={2} open={faces.top()}>...</shell>
 */
export const faces: Sel = new Sel("faces", undefined);

/** A selector string that doesn't parse (the message quotes the input). */
export class SelectorSyntaxError extends Error {
  constructor(message: string, readonly input: string) {
    super(`${message} in selector ${JSON.stringify(input)}`);
    this.name = "SelectorSyntaxError";
  }
}

/** Parse a CadQuery-style selector string into an IR selector. */
export function parseSelector(input: string): Selector {
  const toks = input.match(/\s*([<>|#][XYZxyz]|\*|\(|\)|[A-Za-z]+|\S)/g)?.map((t) => t.trim()) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const word = (t: string | undefined, w: string) => t !== undefined && t.toLowerCase() === w;
  const orExpr = (): Selector => {
    const of = [andExpr()];
    while (word(peek(), "or")) {
      i++;
      of.push(andExpr());
    }
    return of.length === 1 ? of[0]! : { type: "or", of };
  };
  const andExpr = (): Selector => {
    const of = [notExpr()];
    while (word(peek(), "and")) {
      i++;
      of.push(notExpr());
    }
    return of.length === 1 ? of[0]! : { type: "and", of };
  };
  const notExpr = (): Selector => {
    if (word(peek(), "not")) {
      i++;
      return { type: "not", of: notExpr() };
    }
    return atom();
  };
  const atom = (): Selector => {
    const t = toks[i++];
    if (t === undefined) throw new SelectorSyntaxError("unexpected end", input);
    if (t === "(") {
      const s = orExpr();
      if (toks[i++] !== ")") throw new SelectorSyntaxError("missing )", input);
      return s;
    }
    if (t === "*") return { type: "all" };
    if (/^[<>|#][XYZxyz]$/.test(t)) {
      const axis = t[1]!.toLowerCase() as Axis;
      switch (t[0]) {
        case ">":
          return { type: "max", axis };
        case "<":
          return { type: "min", axis };
        case "|":
          return { type: "parallel", axis };
        default:
          return { type: "perpendicular", axis };
      }
    }
    if (word(t, "all")) return { type: "all" };
    if (word(t, "none")) return { type: "none" };
    throw new SelectorSyntaxError(`unexpected ${JSON.stringify(t)} (expected >Z, <Z, |Z, #Z, *, not, or a parenthesis)`, input);
  };
  if (toks.length === 0) throw new SelectorSyntaxError("empty selector", input);
  const s = orExpr();
  if (i < toks.length) throw new SelectorSyntaxError(`unexpected ${JSON.stringify(toks[i])}`, input);
  return s;
}

const IR_TYPES = new Set(["all", "none", "parallel", "perpendicular", "max", "min", "radius", "within", "and", "or", "not", "index"]);

/** Normalise any {@link SelectorLike} to an IR selector. */
export function toSelector(s: SelectorLike, _kind: SelectKind = "edges"): Selector {
  if (s instanceof Sel) return s.toIR();
  if (typeof s === "string") return parseSelector(s);
  if (s && typeof s === "object" && IR_TYPES.has((s as Selector).type)) return s as Selector;
  throw new SelectorSyntaxError(`not a selector: ${typeof s}`, String(s));
}
