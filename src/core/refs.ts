/**
 * Refs: named solids and component instances, and the selectors that pick them
 * (`.plate`, `.bolt > .shank`, `.bolt .head`, `.a, .b`). Used by the ref forms of the boolean
 * and feature elements (`<subtract from tool>`, `<fillet target>`, ...), resolved per part.
 */
import type { SourceLoc } from "./errors";
import type { Mat4 } from "./math";

/** A component call during render: its instance name and where its output starts. */
export interface ComponentInstance {
  /** The component's function name. */
  component: string;
  /** `name` given to the instance, when any. */
  name?: string;
  parent?: ComponentInstance;
  /** The instance's ref when named. */
  ref?: RefNode;
  /** Called with `ghost`: its solids are tools for refs, left out unless used. */
  ghost?: boolean;
  /** Host elements the component returned (directly or through nested components). */
  roots: unknown[];
  loc?: SourceLoc;
}

/** Something a ref selector can match: a named element or a named component instance. */
export interface RefNode {
  name: string;
  kind: "element" | "component";
  /** The element's tag, or the component's function name. */
  tag: string;
  /** The nearest named ancestor (element or component). */
  parent?: RefNode;
  /** The component call this was rendered in. */
  instance?: ComponentInstance;
  /** For a named component: the instance itself. */
  self?: ComponentInstance;
  loc?: SourceLoc;
}

/** One step of a compound selector: `.name`, and how it relates to the step before. */
interface Step {
  name: string;
  /** How this step relates to the previous one: direct child (`>`) or any descendant (` `). */
  combinator?: ">" | " ";
}
/** Alternatives (`,`), each a chain of steps, left to right. */
export type RefSelector = Step[][];

export class RefSyntaxError extends Error {}

/** Parse `".bolt > .shank, .plate"`. */
export function parseRefSelector(src: string): RefSelector {
  if (typeof src !== "string" || !src.trim()) throw new RefSyntaxError("a ref selector must be a non-empty string like \".plate\"");
  return src.split(",").map((alt) => {
    const steps: Step[] = [];
    const tokens = alt.trim().replace(/\s*>\s*/g, " > ").split(/\s+/).filter(Boolean);
    let comb: Step["combinator"] | undefined;
    for (const t of tokens) {
      if (t === ">") {
        if (!steps.length || comb === ">") throw new RefSyntaxError(`misplaced ">" in ${JSON.stringify(src)}`);
        comb = ">";
        continue;
      }
      const m = /^\.([A-Za-z_][\w-]*)$/.exec(t);
      if (!m) {
        throw new RefSyntaxError(
          /^[A-Za-z_][\w-]*$/.test(t) ? `${JSON.stringify(t)} needs a leading dot: ".${t}" (refs pick names, written like CSS classes)` : `can't read ${JSON.stringify(t)} in ref selector ${JSON.stringify(src)}`,
        );
      }
      steps.push({ name: m[1]!, ...(steps.length ? { combinator: comb ?? " " } : {}) });
      comb = undefined;
    }
    if (!steps.length || comb) throw new RefSyntaxError(`incomplete ref selector ${JSON.stringify(src)}`);
    return steps;
  });
}

/** Does `ref` match the chain `steps` (matched right to left, like CSS)? */
function matchChain(ref: RefNode, steps: Step[], i: number): boolean {
  const step = steps[i]!;
  if (ref.name !== step.name) return false;
  if (i === 0) return true;
  if (step.combinator === ">") return !!ref.parent && matchChain(ref.parent, steps, i - 1);
  for (let a = ref.parent; a; a = a.parent) if (matchChain(a, steps, i - 1)) return true;
  return false;
}

export function matches(ref: RefNode, sel: RefSelector): boolean {
  return sel.some((alt) => matchChain(ref, alt, alt.length - 1));
}

/** `.bolt > .shank`: the full chain of names, for messages. */
export function refPath(ref: RefNode): string {
  const names: string[] = [];
  for (let r: RefNode | undefined = ref; r; r = r.parent) names.unshift(`.${r.name}`);
  return names.join(" > ");
}

/** Inverse of an affine row-major 4×4 (rotation/scale/mirror + translation). */
export function invertAffine(m: Mat4): Mat4 {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = m as number[] as [number, number, number, number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error("singular transform");
  const r = 1 / det;
  const m00 = A * r, m01 = -(b * i - c * h) * r, m02 = (b * f - c * e) * r;
  const m10 = B * r, m11 = (a * i - c * g) * r, m12 = -(a * f - c * d) * r;
  const m20 = C * r, m21 = -(a * h - b * g) * r, m22 = (a * e - b * d) * r;
  return [
    m00, m01, m02, -(m00 * tx + m01 * ty + m02 * tz),
    m10, m11, m12, -(m10 * tx + m11 * ty + m12 * tz),
    m20, m21, m22, -(m20 * tx + m21 * ty + m22 * tz),
    0, 0, 0, 1,
  ];
}
