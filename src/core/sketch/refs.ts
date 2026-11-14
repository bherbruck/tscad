/**
 * Typed references for constraint sketches, React-style: attach a handle with `ref={...}` and
 * pass the same handle wherever a string id would go.
 *
 * @example
 * const s = sketchRefs<{ o: "point"; base: "line"; top: "arc" }>()
 * <point ref={s.o} fixed />
 * <line ref={s.base} from={s.o} to={s.a} horizontal />
 * <arc ref={s.top} from={s.base.end} to={s.c} tangent={s.base} radius={5} />
 */

/** What a handle can name. */
export type RefKind = "point" | "line" | "arc" | "circle" | "spline";

const REF: unique symbol = Symbol.for("tscad.sketchRef") as any;

/**
 * A handle to a sketch point or curve. `K` is its kind, checked by TypeScript only:
 * `tangent={somePoint}` doesn't compile. Untyped handles (`sketchRefs()` without a type
 * argument) go anywhere.
 */
export interface SketchRef<K extends RefKind = any> {
  readonly [REF]: true;
  /** @internal the id it stands for inside the sketch. */
  readonly key: string;
  /** The name shown in messages. */
  readonly label: string;
  /** Phantom: the kind, for type checking only. */
  readonly __kind?: K;
  /** The curve's start point (lines, arcs, splines). */
  readonly start: SketchRef<"point">;
  /** The curve's end point (lines, arcs, splines). */
  readonly end: SketchRef<"point">;
  /** The centre point (arcs, circles). */
  readonly center: SketchRef<"point">;
}
export type PointHandle = SketchRef<"point">;
export type LineHandle = SketchRef<"line">;
export type ArcHandle = SketchRef<"arc">;
export type CircleHandle = SketchRef<"circle">;
export type SplineHandle = SketchRef<"spline">;
/** An arc or circle. */
export type RoundHandle = SketchRef<"arc" | "circle">;
/** Any curve. */
export type CurveHandle = SketchRef<"line" | "arc" | "circle" | "spline">;

/** Separates a handle's label from its unique number inside the key (never in user ids). */
export const REF_MARK = "\u0001";
let counter = 0;

function make(label: string, key: string): SketchRef {
  const sub = (s: string) => make(`${label}.${s}`, `${key}.${s}`);
  let st: SketchRef | undefined, en: SketchRef | undefined, ce: SketchRef | undefined;
  return {
    [REF]: true,
    key,
    label,
    get start() {
      return (st ??= sub("start"));
    },
    get end() {
      return (en ??= sub("end"));
    },
    get center() {
      return (ce ??= sub("center"));
    },
    toString: () => label,
  } as SketchRef;
}

/** One typed handle: `const hole = sketchRef<"circle">("hole")`. */
export function sketchRef<K extends RefKind = any>(label?: string): SketchRef<K> {
  const l = (label ?? `ref${counter + 1}`).replace(/[.\s]/g, "_");
  return make(l, `${l}${REF_MARK}${++counter}`) as SketchRef<K>;
}

/**
 * A bag of handles created on first access: `s.o`, `s.base`...
 *
 * - `sketchRefs<{ o: "point"; base: "line" }>()` — kinds checked by TypeScript.
 * - `sketchRefs("o", "a", "base")` — names checked, kinds open (handy with
 *   `noUncheckedIndexedAccess`, where an open-ended bag's members read as possibly undefined).
 * - `sketchRefs()` — anything goes.
 */
export function sketchRefs<T extends Record<string, RefKind> = Record<string, any>>(): { readonly [P in keyof T]: SketchRef<T[P]> };
export function sketchRefs<K extends string>(...names: K[]): { readonly [P in K]: SketchRef };
export function sketchRefs(...names: string[]): Record<string, SketchRef> {
  const cache = new Map<string, SketchRef>();
  const allowed = names.length ? new Set(names) : undefined;
  return new Proxy({} as Record<string, SketchRef>, {
    get(_t, prop) {
      if (typeof prop !== "string" || prop === "then" || prop === "toJSON") return undefined;
      if (allowed && !allowed.has(prop)) throw new Error(`sketchRefs: no handle named "${prop}" (declared: ${[...allowed].join(", ")})`);
      let r = cache.get(prop);
      if (!r) cache.set(prop, (r = sketchRef(prop)));
      return r;
    },
  });
}

export function isSketchRef(v: unknown): v is SketchRef {
  return typeof v === "object" && v !== null && (v as any)[REF] === true;
}

/** A key or id as users see it (drops the handles' unique numbers). */
export function display(s: string): string {
  return s.includes(REF_MARK) ? s.replace(/\u0001\d+/g, "") : s;
}
