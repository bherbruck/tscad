/**
 * Render: expand function components, providers and fragments into a tree of intrinsic
 * ("host") elements, each with its source location.
 */
import { Fragment, isElement, popContext, providerOf, pushContext, type Children, type TscadElement } from "./element";
import { TscadError, type SourceLoc } from "./errors";

/** An intrinsic element after rendering. */
export interface Host {
  tag: string;
  /** Props without `children`. */
  props: Record<string, any>;
  children: Host[];
  loc?: SourceLoc;
  key: string | number | bigint | null;
  /** `<text>` only: its string children, joined. */
  text?: string;
}

function textOf(node: Children, loc: SourceLoc | undefined): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map((c) => textOf(c, loc)).join("");
  throw new TscadError("<text> takes only strings and numbers as children", loc ? { loc } : {});
}

export interface RenderState {
  warnings: string[];
}

const MAX_DEPTH = 2000;

/** Render `node` into host elements. */
export function render(node: Children, state: RenderState): Host[] {
  const out: Host[] = [];
  walk(node, out, state, undefined, undefined, 0);
  return out;
}

function componentName(f: Function): string {
  return (f as any).displayName || f.name || "Anonymous";
}

function walk(
  node: Children,
  out: Host[],
  state: RenderState,
  fallback: SourceLoc | undefined,
  component: string | undefined,
  depth: number,
): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, out, state, fallback, component, depth);
    return;
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    if (typeof node === "string" && node.trim() === "") return;
    state.warnings.push(`${fallback ? `${fallback.file}:${fallback.line}: ` : ""}text child ${JSON.stringify(String(node))} ignored (tscad elements don't render text)`);
    return;
  }
  if (!isElement(node)) {
    if (typeof node === "object" && node !== null && Symbol.iterator in (node as object)) {
      for (const c of node as Iterable<Children>) walk(c, out, state, fallback, component, depth);
      return;
    }
    throw new TscadError(`can't render ${describe(node)} — expected a JSX element`, fallback ? { loc: fallback } : {});
  }
  if (depth > MAX_DEPTH) throw new TscadError("component nesting is too deep (recursive component?)", fallback ? { loc: fallback } : {});
  const el = node as TscadElement;
  const loc = el.source ?? fallback;
  const { type } = el;
  if (type === Fragment) {
    walk(el.props?.children, out, state, loc, component, depth + 1);
    return;
  }
  if (typeof type === "function") {
    const ctx = providerOf(type);
    if (ctx) {
      pushContext(ctx, el.props.value);
      try {
        walk(el.props?.children, out, state, loc, component, depth + 1);
      } finally {
        popContext(ctx);
      }
      return;
    }
    const name = componentName(type);
    const result = type(el.props ?? {});
    if (result instanceof Promise) {
      throw new TscadError(`component <${name}> returned a Promise — components must be synchronous`, loc ? { loc } : {});
    }
    walk(result as Children, out, state, loc, name, depth + 1);
    return;
  }
  if (typeof type !== "string") throw new TscadError(`invalid element type ${describe(type)}`, loc ? { loc } : {});
  const { children, ...props } = (el.props ?? {}) as Record<string, any>;
  const host: Host = { tag: type, props, children: [], key: el.key };
  if (loc) host.loc = { ...loc, tag: type, ...(component ? { component } : {}) };
  if (type === "text") {
    // <text> keeps its string children as the text to draw
    host.text = textOf(children as Children, host.loc);
    out.push(host);
    return;
  }
  walk(children as Children, host.children, state, loc, component, depth + 1);
  out.push(host);
}

function describe(x: unknown): string {
  if (x === null) return "null";
  if (typeof x === "function") return `function ${x.name || "(anonymous)"}`;
  if (typeof x === "object") return x.constructor?.name ? `a ${x.constructor.name}` : "an object";
  return typeof x;
}
