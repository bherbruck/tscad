/**
 * The tscad IR ("cad-json"): what a TSX tree compiles to and what the kernel evaluates.
 *
 * These types are generated from the Rust IR (`crates/tscad-wasm/src/ir.rs`) by tsify into
 * `wasm/tscad_wasm.d.ts` — never restate them by hand. Run `bun run build:wasm` to regenerate.
 */
export type {
  Axis,
  Curve,
  Document,
  EvalError,
  EvalOptions,
  EvalResult,
  MeshData,
  Node,
  Part,
  PartResult,
  PickInfo,
  Selector,
  Suggestion,
  SweepFrame,
} from "../wasm/tscad_wasm";

import type { Node } from "../wasm/tscad_wasm";

/** The `type` tag of every IR node. */
export type NodeType = Node["type"];
/** The IR node with tag `T`. */
export type NodeOf<T extends NodeType> = Extract<Node, { type: T }>;
/** A 3-vector. */
export type Vec3 = [number, number, number];
/** A 4x4 affine matrix, row-major, column-vector convention (p' = M p). */
export type Matrix = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
