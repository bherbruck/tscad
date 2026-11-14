/**
 * Elements, components and context: the React-shaped part of tscad, with no React.
 * Elements are plain objects; function components run at compile time.
 */
import type { SourceLoc } from "./errors";

/** Marks tscad elements. */
export const ELEMENT: unique symbol = Symbol.for("tscad.element") as any;
/** `<>...</>`: renders its children. */
export function Fragment(props: { children?: Children }): Children {
  return props.children;
}
export type FragmentType = typeof Fragment;

/** An element key (diagnostics only; tscad doesn't reconcile). */
export type Key = string | number | bigint;

/** One thing JSX can hold as a child. Booleans, null and undefined render nothing. */
export type Child = TscadElement | string | number | bigint | boolean | null | undefined;
/** Any nesting of children (arrays are flattened). */
export type Children = Child | readonly Children[];

/** A function component: called at compile time with its props (and `children`). */
export type Component<P = {}> = (props: P) => Children;
/** Alias of {@link Component} (React habit). */
export type FC<P = {}> = (props: P & { children?: Children }) => Children;

/** A JSX element: a plain, immutable description of what to build. */
export interface TscadElement<P = any> {
  readonly $$typeof: typeof ELEMENT;
  readonly type: string | Component<any> | FragmentType;
  readonly props: P;
  readonly key: Key | null;
  /** Where it was written (from the dev runtime's `source`, or captured from the stack). */
  readonly source?: SourceLoc;
}
export type { TscadElement as Element };

/** Is `x` a tscad JSX element? */
export function isElement(x: unknown): x is TscadElement {
  return typeof x === "object" && x !== null && (x as any).$$typeof === ELEMENT;
}

/** `createElement(type, props, ...children)` for code that doesn't use JSX syntax. */
export function createElement(
  type: string | Component<any> | FragmentType,
  props?: Record<string, unknown> | null,
  ...children: Children[]
): TscadElement {
  const { key, ...rest } = (props ?? {}) as Record<string, unknown>;
  const p: Record<string, unknown> = rest;
  if (children.length === 1) p.children = children[0];
  else if (children.length > 1) p.children = children;
  return makeElement(type, p, (key as Key | undefined) ?? null, captureSource(2));
}

export function makeElement(type: TscadElement["type"], props: any, key: Key | null | undefined, source?: SourceLoc): TscadElement {
  const el: TscadElement = { $$typeof: ELEMENT, type, props: props ?? {}, key: key ?? null, ...(source ? { source } : {}) };
  return el;
}

// ---------------------------------------------------------------------------------------------
// Source capture

let capture = true;
/**
 * Turn stack-based source capture on or off (default on). Bun's transpiler never passes JSX
 * `source` info, so tscad reads the caller's frame from a stack trace; that costs a few µs per
 * element. Turn it off for very large generated models if you don't need error locations.
 */
export function setSourceCapture(on: boolean): void {
  capture = on;
}

// V8 `at fn (url:l:c)` / `at url:l:c`, JSC the same, Firefox/Safari `fn@url:l:c`.
const FRAME = /^(?:at\s+(?:(.*?)\s+\()?|(.*?)@)?((?:file:\/\/|https?:\/\/|blob:)?[^\s()@]*?):(\d+)(?::(\d+))?\)?$/;
const RUNTIME_FILE = /[\\/](jsx-runtime|jsx-dev-runtime|element)\.(ts|js|mjs)/;
const CORE_FILE = /[\\/]core[\\/](render|compile)\.(ts|js|mjs)/;
/** Bundled runtime chunks served by the dev server (file names not preserved). */
const BUNDLED = /\/__tscad\//;
/** Function names of tscad's element factories (skipped) and renderer (stop: unknown). */
const FACTORY_FNS = /(^|\.)(jsx|jsxs|jsxDEV|makeElement|createElement|captureSource|h)$/;
const RENDER_FNS = /(^|\.)(walk|render|compile|renderModule|document|solid|local)$/;

/**
 * The location of the first frame outside the tscad runtime. Returns undefined when the first
 * such frame is tscad's own renderer (a component's tail call returned the element, so its own
 * frame is gone; the renderer then uses the component's usage site). Raw file/URL is kept
 * (browser bundle URLs included, for sourcemap remapping); line and column are 1-based.
 */
export function captureSource(_skip = 1): SourceLoc | undefined {
  if (!capture) return undefined;
  const E = Error as any;
  const old = E.stackTraceLimit;
  E.stackTraceLimit = 8;
  const stack = new Error().stack ?? "";
  E.stackTraceLimit = old;
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line || line === "Error") continue;
    const m = FRAME.exec(line);
    if (!m) continue;
    const fn = (m[1] ?? m[2] ?? "").replace(/^async\s+/, "");
    const file = m[3]!;
    if (!file || file === "native" || file.startsWith("node:") || file === "[native code]") continue;
    if (RUNTIME_FILE.test(file)) continue;
    if (CORE_FILE.test(file)) return undefined;
    if (BUNDLED.test(file)) {
      if (RENDER_FNS.test(fn)) return undefined;
      continue; // factory or other runtime frame
    }
    if (FACTORY_FNS.test(fn) && /tscad/.test(file)) continue;
    return { file: file.replace(/^file:\/\//, ""), line: Number(m[4]), column: Number(m[5] ?? 0) };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Context

const PROVIDER = Symbol.for("tscad.provider");

/** A value passed down the tree without threading props (`createContext` / `useContext`). */
export interface Context<T> {
  /** `<Ctx.Provider value={...}>children</Ctx.Provider>` */
  Provider: Component<{ value: T; children?: Children }>;
  readonly defaultValue: T;
  /** @internal */
  readonly id: symbol;
  displayName?: string;
}

const contextStack = new Map<symbol, unknown[]>();

/** Create a context with a default value for consumers outside any provider. */
export function createContext<T>(defaultValue: T, displayName?: string): Context<T> {
  const id = Symbol(displayName ?? "context");
  const Provider = ((props: { children?: Children }) => props.children) as Component<{ value: T; children?: Children }>;
  (Provider as any)[PROVIDER] = id;
  const ctx: Context<T> = { Provider, defaultValue, id };
  if (displayName) ctx.displayName = displayName;
  return ctx;
}

/** Read the nearest provided value of `ctx` (call inside a component while it renders). */
export function useContext<T>(ctx: Context<T>): T {
  const s = contextStack.get(ctx.id);
  return s && s.length ? (s[s.length - 1] as T) : ctx.defaultValue;
}

/** @internal the context id a Provider component provides, if it is one. */
export function providerOf(type: unknown): symbol | undefined {
  return typeof type === "function" ? (type as any)[PROVIDER] : undefined;
}
/** @internal */
export function pushContext(id: symbol, value: unknown): void {
  let s = contextStack.get(id);
  if (!s) contextStack.set(id, (s = []));
  s.push(value);
}
/** @internal */
export function popContext(id: symbol): void {
  contextStack.get(id)?.pop();
}
