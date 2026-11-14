/**
 * Render: expand function components, providers and fragments into a tree of intrinsic
 * ("host") elements, each with its source location.
 */
import { Fragment, isElement, popContext, providerOf, pushContext, type Children, type TscadElement } from "./element";
import { TscadError, type SourceLoc } from "./errors";
import type { ComponentInstance, RefNode } from "./refs";

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
  /** Its ref, when it has a `name` (see refs). */
  ref?: RefNode;
  /** The component call it was rendered in. */
  instance?: ComponentInstance;
  /** Component calls this host is a returned root of (outermost first). */
  rootOf?: ComponentInstance[];
}

/** What render passes down: the current component call, nearest named ancestor, and open roots. */
interface Ctx {
  instance?: ComponentInstance;
  ref?: RefNode;
  rootOf: ComponentInstance[];
}

/** Containers whose `name` is a part/drawing name, not a ref. */
const NOT_REFS = new Set(["part", "assembly", "drawing"]);

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
  walk(node, out, state, undefined, undefined, 0, { rootOf: [] });
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
  ctx: Ctx,
): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, out, state, fallback, component, depth, ctx);
    return;
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    if (typeof node === "string" && node.trim() === "") return;
    state.warnings.push(`${fallback ? `${fallback.file}:${fallback.line}: ` : ""}text child ${JSON.stringify(String(node))} ignored (tscad elements don't render text)`);
    return;
  }
  if (!isElement(node)) {
    if (typeof node === "object" && node !== null && Symbol.iterator in (node as object)) {
      for (const c of node as Iterable<Children>) walk(c, out, state, fallback, component, depth, ctx);
      return;
    }
    throw new TscadError(`can't render ${describe(node)}: expected a JSX element`, fallback ? { loc: fallback } : {});
  }
  if (depth > MAX_DEPTH) throw new TscadError("component nesting is too deep (recursive component?)", fallback ? { loc: fallback } : {});
  const el = node as TscadElement;
  const loc = el.source ?? fallback;
  const { type } = el;
  if (type === Fragment) {
    walk(el.props?.children, out, state, loc, component, depth + 1, ctx);
    return;
  }
  if (typeof type === "function") {
    const provided = providerOf(type);
    if (provided) {
      pushContext(provided, el.props.value);
      try {
        walk(el.props?.children, out, state, loc, component, depth + 1, ctx);
      } finally {
        popContext(provided);
      }
      return;
    }
    const name = componentName(type);
    const result = type(el.props ?? {});
    if (result instanceof Promise) {
      throw new TscadError(`component <${name}> returned a Promise; components must be synchronous`, loc ? { loc } : {});
    }
    // every call is an instance (refs inside it resolve within it); a `name` makes it a ref
    const inst: ComponentInstance = { component: name, roots: [], ...(ctx.instance ? { parent: ctx.instance } : {}), ...(loc ? { loc } : {}) };
    const given = el.props?.name;
    if (typeof given === "string" && given) {
      inst.name = given;
      inst.ref = { name: given, kind: "component", tag: name, self: inst, ...(ctx.ref ? { parent: ctx.ref } : {}), ...(ctx.instance ? { instance: ctx.instance } : {}), ...(loc ? { loc } : {}) };
    }
    walk(result as Children, out, state, loc, name, depth + 1, { instance: inst, ref: inst.ref ?? ctx.ref, rootOf: [...ctx.rootOf, inst] });
    return;
  }
  if (typeof type !== "string") throw new TscadError(`invalid element type ${describe(type)}`, loc ? { loc } : {});
  const { children, ...props } = (el.props ?? {}) as Record<string, any>;
  const host: Host = { tag: type, props, children: [], key: el.key };
  if (loc) host.loc = { ...loc, tag: type, ...(component ? { component } : {}) };
  if (ctx.instance) host.instance = ctx.instance;
  if (ctx.rootOf.length) {
    host.rootOf = ctx.rootOf;
    for (const i of ctx.rootOf) i.roots.push(host);
  }
  if (typeof props.name === "string" && props.name && !NOT_REFS.has(type)) {
    host.ref = { name: props.name, kind: "element", tag: type, ...(ctx.ref ? { parent: ctx.ref } : {}), ...(ctx.instance ? { instance: ctx.instance } : {}), ...(host.loc ? { loc: host.loc } : {}) };
  }
  const inner: Ctx = { ...(ctx.instance ? { instance: ctx.instance } : {}), ...(host.ref ?? ctx.ref ? { ref: host.ref ?? ctx.ref } : {}), rootOf: [] };
  if (type === "text") {
    // <text> keeps its string children as the text to draw
    host.text = textOf(children as Children, host.loc);
    out.push(host);
    return;
  }
  walk(children as Children, host.children, state, loc, component, depth + 1, inner);
  out.push(host);
}

function describe(x: unknown): string {
  if (x === null) return "null";
  if (typeof x === "function") return `function ${x.name || "(anonymous)"}`;
  if (typeof x === "object") return x.constructor?.name ? `a ${x.constructor.name}` : "an object";
  return typeof x;
}
