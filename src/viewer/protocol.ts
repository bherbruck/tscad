/**
 * Messages between the viewer page and the eval worker. Plain data only (structured clone), and
 * no server-only concepts: a static playground can drive the same worker.
 */
import type { MeshArrays } from "../kernel";
import type { EvalError, PickInfo } from "../ir";

export type ExportFormat = "step" | "stl" | "3mf" | "glb" | "obj" | "dxf" | "svg";

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

/** A flat `<drawing>` (no thickness): its loops as line segments on z = 0. */
export interface DrawingData {
  name: string;
  color?: string;
  loops: number;
  /** xyz xyz per segment. */
  segments: Float32Array;
}

export interface SketchDimensionData {
  kind: "distance" | "length" | "dx" | "dy" | "radius" | "diameter" | "angle" | "sweep";
  value: number;
  text: string;
  points: [number, number][];
  loc?: Loc;
}

/** A solved constraint sketch (core's `SketchInfo`, locations mapped to the TSX). */
export interface SketchData {
  path: string;
  /** Row-major 4×4: sketch (x, y, 0, 1) → model space. */
  plane: number[];
  loc?: Loc;
  status: "ok" | "under" | (string & {});
  dof: number;
  free: string[];
  residual: number;
  points: { id: string; x: number; y: number; free: boolean }[];
  entities: (
    | { kind: "line"; id?: string; from: [number, number]; to: [number, number]; construction: boolean }
    | { kind: "arc"; id?: string; center: [number, number]; from: [number, number]; to: [number, number]; radius: number; ccw: boolean; construction: boolean }
    | { kind: "circle"; id?: string; center: [number, number]; radius: number; construction: boolean }
    | { kind: "spline"; id?: string; points: [number, number][]; degree: number; construction: boolean }
  )[];
  dimensions: SketchDimensionData[];
  /** The part it belongs to (from `path`). */
  part?: string;
}

export interface EvalData {
  parts: PartData[];
  drawings: DrawingData[];
  sketches: SketchData[];
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
  | { type: "load"; url: string; values?: ParamValuesData; /** Raw source map (else `${url}.map` is fetched). */ map?: object }
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
