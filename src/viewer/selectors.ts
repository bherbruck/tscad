/**
 * IR selectors → TSX you can paste, matching the core's grammar (src/core/select.ts):
 * the CadQuery-style string (`edges=">Z and #Z"`) and the builder (`edges={edges.top().circles()}`).
 * Faces go in `<shell open=...>`; edges in `<fillet|chamfer edges=...>`.
 */
import type { Selector } from "../ir";

/** What a selector selects. */
export type Noun = "edges" | "faces";

const AX = (a: string) => a.toUpperCase();
const num = (n: number) => String(Math.round(n * 1e6) / 1e6);
const vec = (v: [number, number, number]) => `[${v.map(num).join(", ")}]`;

/** String form, or undefined when the selector has no string spelling (radius, within, index). */
export function selectorString(s: Selector): string | undefined {
  switch (s.type) {
    case "all":
      return "*";
    case "none":
      return "none";
    case "parallel":
      return `|${AX(s.axis)}`;
    case "perpendicular":
      return `#${AX(s.axis)}`;
    case "max":
      return `>${AX(s.axis)}`;
    case "min":
      return `<${AX(s.axis)}`;
    case "radius":
    case "within":
    case "index":
      return undefined;
    case "and":
    case "or": {
      const parts = s.of.map((x) => {
        const t = selectorString(x);
        if (t === undefined) return undefined;
        return x.type === "or" && s.type === "and" ? `(${t})` : t;
      });
      return parts.includes(undefined) ? undefined : parts.join(` ${s.type} `);
    }
    case "not": {
      const t = selectorString(s.of);
      if (t === undefined) return undefined;
      return s.of.type === "and" || s.of.type === "or" ? `not (${t})` : `not ${t}`;
    }
  }
}

/** One chained filter step (`top()`, `circles("x")`...) for an atom, or undefined. */
function step(x: Selector): string | undefined {
  switch (x.type) {
    case "max":
      return x.axis === "z" ? "top()" : `max("${x.axis}")`;
    case "min":
      return x.axis === "z" ? "bottom()" : `min("${x.axis}")`;
    case "parallel":
      return x.axis === "z" ? "vertical()" : `parallel("${x.axis}")`;
    case "perpendicular":
      return x.axis === "z" ? "circles()" : `circles("${x.axis}")`;
    case "radius":
      return `radius(${num(x.radius)})`;
    case "within":
      return `within(${vec(x.min)}, ${vec(x.max)})`;
    case "index":
      return `index(${x.indices.join(", ")})`;
    case "all":
      return "all()";
    case "none":
      return "none()";
    default:
      return undefined;
  }
}

/** Builder form rooted at `edges` or `faces`. */
export function selectorBuilder(s: Selector, root: Noun): string {
  const b = (x: Selector): string => {
    const one = step(x);
    if (one) return `${root}.${one}`;
    switch (x.type) {
      case "and": {
        // Atoms chain (each filter ANDs); anything else goes through .and(...).
        let acc: string = root;
        const rest: Selector[] = [];
        for (const y of x.of) {
          const st = step(y);
          if (st && rest.length === 0) acc += `.${st}`;
          else rest.push(y);
        }
        if (acc === root) acc = b(rest.shift()!);
        return rest.reduce<string>((a, y) => `${a}.and(${b(y)})`, acc);
      }
      case "or": {
        const [first, ...rest] = x.of;
        if (!first) return `${root}.none()`;
        return rest.reduce<string>((a, y) => `${a}.or(${b(y)})`, b(first));
      }
      case "not":
        return `${b(x.of)}.not()`;
      default:
        return `${root}.all()`;
    }
  };
  return b(s);
}

/** The prop a selector goes in. */
export const propFor = (root: Noun) => (root === "edges" ? "edges" : "open");

/** The JSX attribute to paste: the string form when it exists and was asked for, else the builder. */
export function selectorAttr(s: Selector, root: Noun, form: "string" | "builder"): string {
  const str = form === "string" ? selectorString(s) : undefined;
  return str !== undefined ? `${propFor(root)}="${str}"` : `${propFor(root)}={${selectorBuilder(s, root)}}`;
}

/** A short human description: "at max Z", "circles about Z"… */
export function describe(s: Selector, noun: Noun): string {
  switch (s.type) {
    case "all":
      return `all ${noun}`;
    case "none":
      return `no ${noun}`;
    case "parallel":
      return noun === "faces" ? `planar, facing ±${AX(s.axis)}` : `straight, along ${AX(s.axis)}`;
    case "perpendicular":
      return noun === "faces" ? `planar, normal ⟂ ${AX(s.axis)}` : `circles about ${AX(s.axis)}`;
    case "max":
      return `at max ${AX(s.axis)}`;
    case "min":
      return `at min ${AX(s.axis)}`;
    case "radius":
      return `radius ${num(s.radius)} mm`;
    case "within":
      return `inside a box`;
    case "index":
      return `by index (brittle)`;
    case "and":
      return s.of.map((x) => describe(x, noun)).join(" & ");
    case "or":
      return s.of.map((x) => describe(x, noun)).join(" | ");
    case "not":
      return `not (${describe(s.of, noun)})`;
  }
}
