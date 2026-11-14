/** IR selectors → the string and builder forms users write. */
import type { Selector } from "../ir";

const AX = (a: string) => a.toUpperCase();

/** The CadQuery-style string, when the selector has one. */
export function selectorString(s: Selector): string | undefined {
  switch (s.type) {
    case "all":
      return "*";
    case "none":
      return "none";
    case "max":
      return `>${AX(s.axis)}`;
    case "min":
      return `<${AX(s.axis)}`;
    case "parallel":
      return `|${AX(s.axis)}`;
    case "perpendicular":
      return `#${AX(s.axis)}`;
    case "not": {
      const x = selectorString(s.of);
      return x === undefined ? undefined : `not ${s.of.type === "and" || s.of.type === "or" ? `(${x})` : x}`;
    }
    case "and":
    case "or": {
      const parts = s.of.map((x) => {
        const t = selectorString(x);
        return t === undefined ? undefined : s.type === "and" && x.type === "or" ? `(${t})` : t;
      });
      return parts.some((p) => p === undefined) ? undefined : parts.join(` ${s.type} `);
    }
    default:
      return undefined;
  }
}

/** Builder code, e.g. `edges.max("z").and(edges.radius(3))`. */
export function selectorCode(s: Selector, root: "edges" | "faces"): string {
  switch (s.type) {
    case "all":
      return `${root}.all()`;
    case "none":
      return `${root}.none()`;
    case "max":
      return s.axis === "z" ? `${root}.top()` : `${root}.max("${s.axis}")`;
    case "min":
      return s.axis === "z" ? `${root}.bottom()` : `${root}.min("${s.axis}")`;
    case "parallel":
      return s.axis === "z" ? `${root}.vertical()` : `${root}.parallel("${s.axis}")`;
    case "perpendicular":
      return root === "edges" ? `${root}.circles(${s.axis === "z" ? "" : `"${s.axis}"`})` : `${root}.perpendicular("${s.axis}")`;
    case "radius":
      return `${root}.radius(${+s.radius.toFixed(6)})`;
    case "within":
      return `${root}.within([${s.min.map((v) => +v.toFixed(4)).join(", ")}], [${s.max.map((v) => +v.toFixed(4)).join(", ")}])`;
    case "index":
      return `${root}.index(${s.indices.join(", ")})`;
    case "not":
      return `${selectorCode(s.of, root)}.not()`;
    case "and":
    case "or": {
      const [first, ...rest] = s.of.map((x) => selectorCode(x, root));
      return rest.reduce((acc, r) => `${acc}.${s.type}(${r})`, first ?? `${root}.all()`);
    }
  }
}
