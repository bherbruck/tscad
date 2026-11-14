/**
 * Messages between the viewer page and the eval worker. Plain data only (structured clone), and
 * no server-only concepts: a static playground can drive the same worker.
 */
import type { MeshArrays } from "../kernel";
import type { EvalError, PickInfo } from "../ir";

/** Formats the viewer can export. */
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

/** A param spec as it travels to the viewer (loosely typed: older and hand-written schemas too). */
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

/** Param specs by key. */
export type ParamSchemaData = Record<string, ParamSpec>;
/** Param values by key. */
export type ParamValuesData = Record<string, unknown>;

/** A part as the viewer shows it: result, stats, material and errors. */
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

/** A flat `<drawing>` (no thickness): its loops and open paths as line segments on z = 0, and its text notes. */
export interface DrawingData {
  name: string;
  color?: string;
  loops: number;
  /** Open paths (bend lines...). */
  paths: number;
  /** DXF/SVG layer (`cut`, `bend`, `engrave`...), when set. */
  layer?: string;
  /** xyz xyz per segment: the closed loops. */
  segments: Float32Array;
  /** xyz xyz per segment: the open paths (drawn dashed). */
  pathSegments?: Float32Array;
  /** Text notes: centred at `at`, `size` mm tall, `angle` degrees CCW. */
  notes?: DrawingNoteData[];
}

/** A text note on a drawing. */
export interface DrawingNoteData {
  at: [number, number];
  text: string;
  size: number;
  angle?: number;
}

/** A sketch dimension with where to draw it. */
export interface SketchDimensionData {
  kind: "distance" | "length" | "dx" | "dy" | "radius" | "diameter" | "angle" | "sweep";
  value: number;
  text: string;
  points: [number, number][];
  loc?: Loc;
}

/** A pattern copy: which entity it copies, in which pattern, which copy (1, 2...). */
export interface CopyOf {
  index: number;
  pattern: number;
  copy: number;
}

/** A sketch pattern (linear or circular) with its instances. */
export interface SketchPatternData {
  kind: "mirror" | "circular" | "linear" | (string & {});
  of: number[];
  copies: number[][];
  center?: [number, number];
  /** Degrees between copies (circular). */
  angle?: number;
  /** Mirror line. */
  axis?: [[number, number], [number, number]];
  step?: [number, number];
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
    | { kind: "line"; id?: string; from: [number, number]; to: [number, number]; construction: boolean; copyOf?: CopyOf }
    | { kind: "arc"; id?: string; center: [number, number]; from: [number, number]; to: [number, number]; radius: number; ccw: boolean; construction: boolean; copyOf?: CopyOf }
    | { kind: "circle"; id?: string; center: [number, number]; radius: number; construction: boolean; copyOf?: CopyOf }
    | { kind: "spline"; id?: string; points: [number, number][]; degree: number; construction: boolean; copyOf?: CopyOf }
  )[];
  dimensions: SketchDimensionData[];
  /** In-sketch patterns: entity indices of the originals and of each copy. */
  patterns?: SketchPatternData[];
  /** The part it belongs to (from `path`). */
  part?: string;
}

/** A param that drives a mate value linearly: value ≈ base + scale × (param − its current value). */
export interface MateDrive {
  param: string;
  /** d(mate value) / d(param) at the current values. */
  scale: number;
}

/** An assembly mate: its parts, values, residual and drive params. */
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

/** Everything one evaluation sends to the viewer. */
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

/** A failure at one stage (bundle, render, kernel), located in the source. */
export interface StageError {
  stage: "import" | "render" | "kernel" | "worker";
  message: string;
  stack?: string;
  loc?: Loc;
  frame?: CodeFrame;
}

/** Messages to the eval worker. */
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
  /** Free the kernels (server-side: stop the kernel processes). */
  | { type: "dispose" }
  /** Geometry diff mode: after each evaluation, diff against the previous one (or the pinned one). */
  | { type: "diff"; on: boolean }
  /** Pin the current evaluation as the diff baseline (or unpin: back to "previous"). */
  | { type: "diff-pin"; pin: boolean }
  /** Print plates of the current model (orient + pack); `download` also returns each plate as 3MF. */
  | { type: "plate"; id: number; bed: [number, number]; spacing: number; orient: "auto" | "keep"; copies?: Record<string, number>; download?: boolean }
  /** Re-solve sketch `sketch` (index in the last result's `sketches`) with `point` dragged to `target` (sketch coords). */
  | { type: "sketch-drag"; id: number; sketch: number; point: string; target: [number, number]; changeDimensions: boolean }
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

/** Printability check results per part (overhang and thin-wall faces). */
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

/** Interference check results: overlapping part pairs and their volumes. */
export interface InterferenceData {
  pairs: { a: string; b: string; volume: number; mesh?: { positions: Float32Array; indices: Uint32Array } }[];
  checked: number;
  errors: { a: string; b: string; message: string }[];
  millis: number;
}

/** Messages from the eval worker. */
export type FromWorker =
  | { type: "ready"; version: string; loadMs: number; pool: number; /** Evaluating with the native kernel (server-side). */ native?: boolean }
  | { type: "busy"; stage: "loading" | "rendering" | "evaluating" }
  | { type: "result"; data: EvalData }
  | { type: "error"; error: StageError; schema?: ParamSchemaData; values?: ParamValuesData }
  | { type: "pick"; id: number; info?: PickInfo; error?: string }
  | { type: "export"; id: number; data?: Uint8Array | string; error?: string }
  | { type: "check"; id: number; printability?: PrintabilityData[]; interference?: InterferenceData; error?: string }
  | { type: "diff"; data: DiffData }
  | { type: "sketch-drag"; id: number; result?: SketchDragData; error?: string }
  | { type: "plate"; id: number; result?: PlateData; files?: Uint8Array[]; error?: string };

/** A print plate layout for the viewer. */
export interface PlateData {
  plates: number;
  bed: [number, number];
  items: { name: string; copy: number; plate: number; transform: number[]; bottom: string; overhang: number; overhangArea: number; height: number; rect: [number, number, number, number]; rotated90: boolean }[];
}

/** A sketch re-solved with one point dragged (core's `dragSolve`), locations mapped to the TSX. */
export interface SketchDragData {
  reached: boolean;
  points: { id: string; x: number; y: number; moved: boolean; free: boolean }[];
  entities: SketchData["entities"];
  blockedBy: { label: string; loc?: Loc; dimension?: { kind: string; value: number; prop?: string } }[];
  /** Source edits that make the drag the new design (`applyChanges` input). */
  changes: SketchChange[];
}

/** A sketch edit from a drag: a dimension or a point moved. */
export type SketchChange =
  | { kind: "prop"; loc: Loc; tag: string; prop: string; value: number; reason: "point" | "dimension"; param?: { name: string; value: number } }
  | { kind: "addPoint"; sketch: Loc; id: string; x: number; y: number };

/** A geometry diff against the pinned version. */
export interface DiffData {
  /** The evaluation (`EvalData.seq`) this diff is for. */
  seq: number;
  baseline: "previous" | "pinned" | "none";
  /** What the baseline was (pinned params, for the panel). */
  baselineValues?: ParamValuesData;
  parts: import("./diff").DiffPartData[];
  /** Added / removed solids per part, for drawing. */
  meshes: { part: string; added?: MeshArrays; removed?: MeshArrays }[];
  millis: number;
}
