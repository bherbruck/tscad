/**
 * Typed anchor references for mates: `const A = assemblyRefs<{ motor: "shaft" | "mount"; pulley: "bore" }>()`
 * then `<part name={A.motor.name}>` and `<mate a={A.motor.shaft} b={A.pulley.bore} />`.
 */
const ANCHOR: unique symbol = Symbol.for("tscad.anchorRef") as any;

/** A part's anchor, as `"part.anchor"`. */
export interface AnchorRef<P extends string = string> {
  readonly [ANCHOR]: true;
  readonly part: P;
  readonly id: string;
  toString(): string;
}

/** A part's handles: `.name` and one handle per anchor id. */
export type PartRef<P extends string, A extends string> = { readonly name: P } & { readonly [K in A]: AnchorRef<P> };

export function anchorRef<P extends string>(part: P, id: string): AnchorRef<P> {
  return { [ANCHOR]: true, part, id, toString: () => `${part}.${id}` } as AnchorRef<P>;
}

/**
 * Handles for parts and their anchors, created on access. The type argument maps part names
 * to their anchor ids, so typos don't compile.
 */
export function assemblyRefs<T extends Record<string, string> = Record<string, any>>(): { readonly [P in keyof T & string]: PartRef<P, T[P] & string> } {
  const parts = new Map<string, unknown>();
  return new Proxy({} as any, {
    get(_t, part) {
      if (typeof part !== "string" || part === "then" || part === "toJSON") return undefined;
      let p = parts.get(part);
      if (!p) {
        const anchors = new Map<string, AnchorRef>();
        p = new Proxy({} as any, {
          get(_u, id) {
            if (typeof id !== "string" || id === "then" || id === "toJSON") return undefined;
            if (id === "name") return part;
            let a = anchors.get(id);
            if (!a) anchors.set(id, (a = anchorRef(part, id)));
            return a;
          },
        });
        parts.set(part, p);
      }
      return p;
    },
  });
}

export function isAnchorRef(v: unknown): v is AnchorRef {
  return typeof v === "object" && v !== null && (v as any)[ANCHOR] === true;
}
