/**
 * Drag-to-edit for constraint sketches: re-solve with a point dragged, then work out which
 * source changes make that the new design (point guesses, dimension literals, or the param
 * that drives a dimension).
 *
 * ```ts
 * const r = dragSolve(mod, values, { sketch: info.loc, point: "h", target: [12, 30] })
 * for (const c of r.changes) applyChange(source, c)   // → new source, or why not (+ the param)
 * ```
 */
import { makeElement, type Component } from "../element";
import { TscadError, type SourceLoc } from "../errors";
import type { ParamSchema } from "../params";
import { render, type Host } from "../render";
import { dragSketch, type DragConstraint, type DragResult } from "./constrained";
import { editProp, editProps, formatNumber, insertChild, type EditResult } from "./edit";

export { editProp, editProps, formatNumber, insertChild, type EditResult, type TextEdit } from "./edit";

export interface DragRequest {
  /** The `<sketch>`'s location (`CompileResult.sketches[i].loc`). */
  sketch: SourceLoc;
  /** Which occurrence when the same `<sketch>` line renders several times (a component used twice). Default 0. */
  occurrence?: number;
  /** The dragged point's id (`SketchInfo.points[i].id`). */
  point: string;
  /** Where it was dragged to, in sketch coordinates. */
  target: [number, number];
  /** Release the dimensions that block the drag and report their new values. */
  changeDimensions?: boolean;
}

/** A param that drives a prop linearly: setting it to `value` gives the wanted prop value. */
export interface ParamDrive {
  name: string;
  value: number;
}

/** One source change that makes the drag the new design. */
export type DragChange =
  | {
      kind: "prop";
      /** The element (its `<`). */
      loc: SourceLoc;
      tag: string;
      prop: string;
      value: number;
      /** Why: a moved free point's guess, or a dimension released by the drag. */
      reason: "point" | "dimension";
      /** When the prop is an expression of one param: the param value that gives `value`. */
      param?: ParamDrive;
    }
  | {
      /** A free point with no `<point>` element: add one with its new rough position. */
      kind: "addPoint";
      sketch: SourceLoc;
      id: string;
      x: number;
      y: number;
    };

export interface DragSolveResult extends Omit<DragResult, "points" | "blockedBy" | "dimensionChanges"> {
  points: { id: string; x: number; y: number; moved: boolean; free: boolean }[];
  /** What keeps the point from the target: labels and source locations ("length=40 on line …"). */
  blockedBy: { label: string; loc?: SourceLoc; dimension?: { kind: string; value: number; prop?: string } }[];
  changes: DragChange[];
}

interface Module {
  default: Component<any>;
  params?: ParamSchema;
}

const sameLoc = (a?: SourceLoc, b?: SourceLoc) => !!a && !!b && a.file === b.file && a.line === b.line && a.column === b.column;

function findHost(roots: Host[], loc: SourceLoc, tag: string | undefined, occurrence = 0): Host | undefined {
  let n = 0;
  let found: Host | undefined;
  const walk = (h: Host) => {
    if (found) return;
    if ((!tag || h.tag === tag) && sameLoc(h.loc, loc) && n++ === occurrence) found = h;
    h.children.forEach(walk);
  };
  roots.forEach(walk);
  return found;
}

function renderHosts(mod: Module, values: Record<string, unknown>): Host[] {
  return render(makeElement(mod.default, { ...values }, null), { warnings: [] });
}

/**
 * Is element `loc`'s `prop` driven linearly by exactly one numeric param? Perturb each param,
 * re-render (no solving), and read the prop: then the param value that gives `want`.
 */
export function paramFor(mod: Module, values: Record<string, unknown>, loc: SourceLoc, tag: string, prop: string, want: number, occurrence = 0): ParamDrive | undefined {
  const read = (vals: Record<string, unknown>) => {
    const h = findHost(renderHosts(mod, vals), loc, tag, occurrence);
    const v = h?.props[prop];
    return typeof v === "number" ? v : undefined;
  };
  const v0 = read(values);
  if (v0 === undefined) return undefined;
  const found: ParamDrive[] = [];
  for (const [name, spec] of Object.entries(mod.params ?? {})) {
    if (spec.type !== "number" && spec.type !== "int") continue;
    const p0 = values[name];
    if (typeof p0 !== "number") continue;
    const dlt = Math.max(1e-3, Math.abs(p0) * 1e-3);
    const up = read({ ...values, [name]: p0 + dlt }), down = read({ ...values, [name]: p0 - dlt });
    if (up === undefined || down === undefined) continue;
    const slope = (up - v0) / dlt, slope2 = (v0 - down) / dlt;
    if (Math.abs(slope) < 1e-12) continue;
    // linear (in this param, here): both sides agree
    if (Math.abs(slope - slope2) > 1e-6 * Math.max(1, Math.abs(slope))) continue;
    found.push({ name, value: Number((p0 + (want - v0) / slope).toFixed(6)) });
  }
  return found.length === 1 ? found[0] : undefined;
}

/** Drag a point of the `<sketch>` at `req.sketch` and work out the source changes. */
export function dragSolve(mod: Module, values: Record<string, unknown>, req: DragRequest): DragSolveResult {
  const hosts = renderHosts(mod, values);
  const sketch = findHost(hosts, req.sketch, "sketch", req.occurrence ?? 0);
  if (!sketch) throw new TscadError(`no <sketch> at ${req.sketch.file}:${req.sketch.line}:${req.sketch.column}`);
  const r = dragSketch(sketch, req.point, req.target, { changeDimensions: req.changeDimensions ?? false });
  const changes: DragChange[] = [];
  const occ = (h: Host) => {
    // which occurrence of that element's location this host is (components used twice)
    let n = -1, k = -1;
    const walk = (x: Host) => {
      if (sameLoc(x.loc, h.loc) && x.tag === h.tag) {
        n++;
        if (x === h) k = n;
      }
      x.children.forEach(walk);
    };
    hosts.forEach(walk);
    return Math.max(0, k);
  };
  const propChange = (h: Host, prop: string, value: number, reason: "point" | "dimension"): DragChange | undefined => {
    if (!h.loc) return undefined;
    const raw = h.props[prop];
    const literalish = raw === undefined || typeof raw === "number";
    const param = literalish ? paramFor(mod, values, h.loc, h.tag, prop, value, occ(h)) : undefined;
    return { kind: "prop", loc: h.loc, tag: h.tag, prop, value: Number(value.toFixed(6)), reason, ...(param ? { param } : {}) };
  };
  // moved free points: their guesses become the new drawing
  for (const p of r.points) {
    if (!p.moved || !p.free) continue;
    if (p.host?.tag === "point") {
      const at = Array.isArray(p.host.props.at) ? (p.host.props.at as number[]) : [0, 0];
      for (const [prop, v] of [["x", p.x - (at[0] ?? 0)], ["y", p.y - (at[1] ?? 0)]] as const) {
        const c = propChange(p.host, prop, v, "point");
        if (c) changes.push(c);
      }
    } else if (!p.host && sketch.loc && /^[\w$-]+$/.test(p.id)) changes.push({ kind: "addPoint", sketch: sketch.loc, id: p.id, x: Number(p.x.toFixed(6)), y: Number(p.y.toFixed(6)) });
  }
  for (const dc of r.dimensionChanges) {
    if (!dc.dim?.prop) continue;
    const c = propChange(dc.host, dc.dim.prop, dc.to, "dimension");
    if (c) changes.push(c);
  }
  const plain = (b: DragConstraint) => ({ label: b.label, ...(b.host.loc ? { loc: b.host.loc } : {}), ...(b.dim ? { dimension: b.dim } : {}) });
  return {
    points: r.points.map(({ id, x, y, moved, free }) => ({ id, x, y, moved, free })),
    reached: r.reached,
    blockedBy: r.blockedBy.map(plain),
    changes,
    entities: r.entities,
  };
}

/**
 * Apply one drag change to the TSX source. A prop set by an expression is refused; when a
 * single param drives it the result says which (`param`), so the UI can move that slider.
 */
export function applyChange(source: string, change: DragChange): EditResult & { param?: ParamDrive } {
  if (change.kind === "addPoint") return insertChild(source, change.sketch, `<point id="${change.id}" x={${formatNumber(change.x)}} y={${formatNumber(change.y)}} />`);
  const r = editProp(source, { ...change.loc, tag: change.tag }, change.prop, change.value);
  if (r.ok || !change.param) return r;
  return { ...r, reason: `${r.reason}: driven by param ${change.param.name}`, param: change.param };
}

/** Apply several changes in one go (prop edits first, then added points). */
export function applyChanges(source: string, changes: DragChange[]): { source: string; applied: DragChange[]; refused: { change: DragChange; reason: string; param?: ParamDrive }[] } {
  let cur = source;
  const applied: DragChange[] = [], refused: { change: DragChange; reason: string; param?: ParamDrive }[] = [];
  // prop edits stay on their lines; added points shift the lines below, so they go last
  for (const c of [...changes].sort((a, b) => Number(a.kind === "addPoint") - Number(b.kind === "addPoint"))) {
    const r = applyChange(cur, c);
    if (r.ok) {
      cur = r.source;
      applied.push(c);
    } else refused.push({ change: c, reason: r.reason, ...("param" in r && r.param ? { param: r.param } : {}) });
  }
  return { source: cur, applied, refused };
}

void editProps;
