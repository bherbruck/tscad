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

/** A param that drives a mate value linearly: value ≈ base + scale × (param − its current value). */
export interface MateDrive {
  param: string;
  /** d(mate value) / d(param) at the current values. */
  scale: number;
}

export interface MateData {
  a: string;
  b: string;
  type: "fastened" | "revolute" | "slider" | "cylindrical" | "planar" | "ball" | (string & {});
  angle?: number;
  offset?: number;
  flip: boolean;
  residual: number;
  ok: boolean;
  loc?: Loc;
  /** Params found to drive `angle` / `offset` (by perturbing them and re-rendering). */
  drive?: { angle?: MateDrive; offset?: MateDrive };
}

/** Core's `AssemblyInfo`, locations mapped to the TSX. */
export interface AssemblyData {
  parts: { name: string; transform: number[]; dof: number; grounded: boolean }[];
  mates: MateData[];
  anchors: { part: string; id: string; frame: number[]; loc?: Loc }[];
}

export interface EvalData {
  assembly?: AssemblyData;
  parts: PartData[];
  drawings: DrawingData[];
  sketches: SketchData[];
  schema: ParamSchemaData;
  values: ParamValuesData;
  warnings: string[];
  cacheHits: number;
  cacheMisses: number;
  timings: { render: number; kernel: number; mesh: number; total: number };
  /** Kernels that evaluated this result in parallel. */
  workers: number;
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
  | {
      type: "init";
      wasmUrl: string;
      glueUrl: string;
      /** Max kernels evaluating parts in parallel (default: cores − 1, ≤ 4; 1 = off). */
      pool?: number;
      /** In bun (the dev server's eval worker): the default kernel, native when built. */
      native?: boolean;
    }
  | { type: "load"; url: string; values?: ParamValuesData; /** Raw source map (else `${url}.map` is fetched). */ map?: object }
  | { type: "params"; values: ParamValuesData }
  | { type: "pick"; id: number; kind: "edge" | "face"; part: string; index: number }
  | { type: "export"; id: number; format: ExportFormat; parts: { name: string; color?: string }[]; tolerance?: number }
  | { type: "check"; id: number; kind: "printability"; parts: CheckMeshData[]; maxOverhangDeg: number; minWall: number; thickness: boolean }
  | { type: "check"; id: number; kind: "interference"; parts: string[] };

/** A display mesh sent to the worker for printability checks (a copy; triangle order kept). */
export interface CheckMeshData {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  faceIds: Uint32Array;
}

export interface PrintabilityData {
  name: string;
  /** Per triangle, 0 = fine … 1 = flat ceiling. */
  severity: Float32Array;
  overhangArea: number;
  overhangFraction: number;
  /** Per vertex wall thickness, mm (absent when skipped). */
  thickness?: Float32Array;
  minWall?: number;
  thinFraction?: number;
  warnings: string[];
}

export interface InterferenceData {
  pairs: { a: string; b: string; volume: number; mesh?: { positions: Float32Array; indices: Uint32Array } }[];
  checked: number;
  errors: { a: string; b: string; message: string }[];
  millis: number;
}

export type FromWorker =
  | { type: "ready"; version: string; loadMs: number; pool: number; /** Evaluating with the native kernel (server-side). */ native?: boolean }
  | { type: "busy"; stage: "loading" | "rendering" | "evaluating" }
  | { type: "result"; data: EvalData }
  | { type: "error"; error: StageError; schema?: ParamSchemaData; values?: ParamValuesData }
  | { type: "pick"; id: number; info?: PickInfo; error?: string }
  | { type: "export"; id: number; data?: Uint8Array | string; error?: string }
  | { type: "check"; id: number; printability?: PrintabilityData[]; interference?: InterferenceData; error?: string };
