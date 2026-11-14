/**
 * tscad's JSX runtime (`"jsxImportSource": "tscad"`). No React: elements are plain objects and
 * function components run at compile time.
 */
import { captureSource, Fragment, makeElement, type Children, type Component, type Key, type TscadElement } from "./core/element";
import type { IntrinsicElements as Intrinsics } from "./core/intrinsics";

export { Fragment };

/** Create an element (one or no children). */
export function jsx(type: TscadElement["type"], props: Record<string, unknown>, key?: Key): TscadElement {
  return makeElement(type, props, key, captureSource());
}
/** Create an element (static children array). */
export function jsxs(type: TscadElement["type"], props: Record<string, unknown>, key?: Key): TscadElement {
  return makeElement(type, props, key, captureSource());
}

export declare namespace JSX {
  /** What a JSX expression evaluates to. */
  type Element = TscadElement;
  /** Anything usable as a tag: an intrinsic name or a function component. */
  type ElementType = keyof Intrinsics | ((props: any) => Children);
  /** Props of every lowercase element (`<box>`, `<extrude>`, ...). */
  interface IntrinsicElements extends Intrinsics {}
  /** Props every element accepts. */
  interface IntrinsicAttributes {
    /** Reconciliation key (diagnostics only). */
    key?: Key;
  }
  /** `children` is the prop that receives JSX children. */
  interface ElementChildrenAttribute {
    children: {};
  }
  type LibraryManagedAttributes<_C, P> = P;
}

export type { Children, Component, TscadElement as Element };
