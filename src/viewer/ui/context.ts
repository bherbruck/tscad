/**
 * What the viewer (app.ts) shares with its UI feature modules (ui/*.ts). app.ts hands over an
 * object of lazy getters; each feature function destructures the names it uses when it runs.
 */
import type { PickInfo } from "../../ir";
import type { AssemblyOverlay } from "../assembly-overlay";
import type { CheckMode, CheckOverlay } from "../check-overlay";
import type { DiffOverlay } from "../diff-overlay";
import type { ParamsPanel } from "../params";
import type { PlateOverlay } from "../plate-overlay";
import type { BundleError, ViewerConfig } from "../app";
import type { DiffData, EvalData, Loc, ParamSchemaData, ParamValuesData, PlateData, SketchData, SketchDimensionData, MateData, StageError, ToWorker } from "../protocol";
import type { Hit, Viewport } from "../scene";
import type { SketchOverlay } from "../sketch-overlay";

/** The viewer's mutable state. */
export interface ViewerState {
  data?: EvalData;
  error?: StageError;
  bundleErrors: BundleError[];
  schema: ParamSchemaData;
  values: ParamValuesData;
  file: string;
  busy: string;
  kernelReady: boolean;
  kernelVersion: string;
  bundleUrl: string;
  selection?: { hit: Hit; info?: PickInfo; error?: string };
  form: "string" | "builder";
  measure: boolean;
  colors: Record<string, string>;
  connected: boolean;
  buildAt: number;
  editToRender: number;
}

/** What a viewer click points at in the source. */
export type SourceTarget = Parameters<NonNullable<ViewerConfig["onSourceClick"]>>[1];

/** A worker request that gets a reply (`id` is added by `request`). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A worker request without its id (the viewer assigns one). */
export type WorkerRequest = DistributiveOmit<Extract<ToWorker, { id: number }>, "id">;

/** What the viewer UI modules share: state, scene, DOM nodes and messaging. */
export interface ViewerContext {
  cfg: ViewerConfig;
  state: ViewerState;
  viewport: Viewport;
  params: ParamsPanel;
  sketches: SketchOverlay;
  assembly: AssemblyOverlay;
  checks: CheckOverlay;
  diffView: DiffOverlay;
  plateView: PlateOverlay;
  checkState: { mode: CheckMode; maxOverhang: number; minWall: number; busy: boolean; again: boolean };
  diffState: { on: boolean; pinned: boolean; data?: DiffData };
  plateState: { on: boolean; bed: [number, number]; spacing: number; orient: "auto" | "keep"; data?: PlateData; busy: boolean; again: boolean; error: string };
  /** Toolbar buttons the features toggle. */
  tb: Record<"iso" | "top" | "front" | "right" | "fit" | "ortho" | "edges" | "wire" | "xray" | "section" | "measure" | "sketch" | "anchors" | "diff" | "plate" | "checks", HTMLButtonElement>;
  worker: { postMessage(msg: ToWorker): void };
  // DOM
  checksPop: HTMLElement;
  checkSummary: HTMLElement;
  diffBody: HTMLElement;
  diffCard: HTMLElement;
  errorBox: HTMLElement;
  exportBtn: HTMLElement;
  exportMenu: HTMLElement;
  gizmo: HTMLElement;
  helpPop: HTMLElement;
  inspectorBody: HTMLElement;
  inspectorCard: HTMLElement;
  partsList: HTMLElement;
  pinBtn: HTMLElement;
  plateBody: HTMLElement;
  plateCard: HTMLElement;
  statsBody: HTMLElement;
  statsSummary: HTMLElement;
  sectionPop: HTMLElement;
  helpBtn: HTMLElement;
  /** The side columns (panel insets, help popover placement). */
  left: HTMLElement;
  right: HTMLElement;
  // functions
  request<T>(msg: WorkerRequest): Promise<T>;
  send(msg: ToWorker): void;
  toast(text: string, sticky?: boolean): () => void;
  showTip(text: string): void;
  sourceClick(loc: Loc, target: SourceTarget): void;
  updateInsets(): void;
  applySketchVisibility(): void;
  applyAnchorButton(): void;
  row(k: string, v: string | HTMLElement): HTMLElement;
}

export type { MateData, SketchData, SketchDimensionData };
