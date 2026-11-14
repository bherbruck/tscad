/**
 * Messages between the viewer page and the eval worker. Plain data only (structured clone), and
 * no server-only concepts: a static playground can drive the same worker.
 */
import type { MeshArrays } from "../kernel";
import type { EvalError, PickInfo } from "../ir";

export type ExportFormat = "step" | "stl" | "3mf" | "glb" | "obj";

/** A TSX source position (1-based line and column). */
export interface Loc {
  file: string;
  line: number;
  column: number;
}

/** A few lines of source around a {@link Loc}. */
export interface CodeFrame {
  file: string;
  line: number;
  column: number;
  /** `[lineNumber, text]` pairs. */
  lines: [number, string][];
}

export interface ParamSpec {
  type: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  description?: string;
  group?: string;
  options?: readonly (string | number | { value: string | number; label?: string })[];
  [key: string]: unknown;
}

export type ParamSchemaData = Record<string, ParamSpec>;
export type ParamValuesData = Record<string, unknown>;

export interface PartData {
  name: string;
  color?: string;
  ok: boolean;
  empty: boolean;
  error?: EvalError & { loc?: Loc; frame?: CodeFrame };
  volume?: number;
  area?: number;
  bbox?: [[number, number, number], [number, number, number]];
  counts?: [number, number, number];
  warnings: string[];
  millis: number;
  cached: boolean;
  /** g/cm³ when the model says. */
  density?: number;
  material?: string;
  mesh?: MeshArrays;
}

export interface EvalData {
  parts: PartData[];
  schema: ParamSchemaData;
  values: ParamValuesData;
  warnings: string[];
  cacheHits: number;
  cacheMisses: number;
  timings: { render: number; kernel: number; mesh: number; total: number };
  /** Increments with every evaluation. */
  seq: number;
}

export interface StageError {
  stage: "import" | "render" | "kernel" | "worker";
  message: string;
  stack?: string;
  loc?: Loc;
  frame?: CodeFrame;
}

export type ToWorker =
  | { type: "init"; wasmUrl: string; glueUrl: string }
  | { type: "load"; url: string; values?: ParamValuesData }
  | { type: "params"; values: ParamValuesData }
  | { type: "pick"; id: number; kind: "edge" | "face"; part: string; index: number }
  | { type: "export"; id: number; format: ExportFormat; parts: { name: string; color?: string }[]; tolerance?: number };

export type FromWorker =
  | { type: "ready"; version: string; loadMs: number }
  | { type: "busy"; stage: "loading" | "rendering" | "evaluating" }
  | { type: "result"; data: EvalData }
  | { type: "error"; error: StageError; schema?: ParamSchemaData; values?: ParamValuesData }
  | { type: "pick"; id: number; info?: PickInfo; error?: string }
  | { type: "export"; id: number; data?: Uint8Array | string; error?: string };
