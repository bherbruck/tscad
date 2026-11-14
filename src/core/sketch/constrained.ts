/**
 * Constraint sketches: `<sketch>` containing `<point>`, `<line>`, `<arc>`, `<circle center=…>`,
 * `<spline>` and constraints (as props or as `<dimension>`, `<coincident>`, `<tangent>`...
 * elements). The sketch is turned into a constraint system, solved (./solver), checked
 * (degrees of freedom, conflicts, redundancy — with JSX source locations), and its
 * non-construction curves are chained into closed loops for extrude / revolve / loft / sweep.
 */
import type { Node } from "../../ir";
import { TscadError, type SourceLoc } from "../errors";
import { mul as mul4, type Mat4, type Vec2 } from "../math";
import type { Host } from "../render";
import type { Frame } from "./place";
import { arc as arcSeg, line as lineSeg, polyline, reverseSeg, TAU, transformLoop, type Affine2, type Loop2, type Seg2 } from "./seg";
import { display, isSketchRef, REF_MARK } from "./refs";
import * as d from "./solver/dual";
import { analyze, findConflict, lm, type Constraint, type System } from "./solver/solve";

// ---------------------------------------------------------------------------------------------
// Public metadata (CompileResult.sketches)

/** A solved sketch entity, in sketch coordinates (mm). */
export type SketchEntityInfo =
  | { kind: "line"; id?: string; from: Vec2; to: Vec2; fromId: string; toId: string; construction: boolean }
  | { kind: "arc"; id?: string; center: Vec2; from: Vec2; to: Vec2; radius: number; ccw: boolean; construction: boolean }
  | { kind: "circle"; id?: string; center: Vec2; radius: number; construction: boolean }
  | { kind: "spline"; id?: string; points: Vec2[]; degree: number; construction: boolean };

/**
 * A driving dimension for overlay drawing. `points` (sketch coordinates) by kind:
 * distance/length/dx/dy: `[a, b]` the two measured points (point–line: the point and its foot);
 * radius/diameter: `[center, pointOnCurve]`; angle: `[vertex, onA, onB]`; sweep: `[center, from, to]`.
 */
export interface SketchDimensionInfo {
  kind: "distance" | "length" | "dx" | "dy" | "radius" | "diameter" | "angle" | "sweep";
  /** mm, or degrees for angle/sweep. */
  value: number;
  /** Ready-to-draw label: `40`, `R5`, `⌀10`, `30°`. */
  text: string;
  points: Vec2[];
  loc?: SourceLoc;
}

/** The solve of one constraint sketch. */
export interface SolvedSketch {
  /** Where the `<sketch>` was written. */
  loc?: SourceLoc;
  /** `"ok"`: fully constrained; `"under"`: degrees of freedom remain (still solved). */
  status: "ok" | "under";
  /** Remaining degrees of freedom (variables − Jacobian rank). */
  dof: number;
  /** Human names of what is still free (`point "h"`, `circle "hole" radius`). */
  free: string[];
  /** Largest constraint residual at the solution, mm. */
  residual: number;
  iterations: number;
  points: { id: string; x: number; y: number; free: boolean }[];
  entities: SketchEntityInfo[];
  dimensions: SketchDimensionInfo[];
}

/** A solved sketch placed in the model: `CompileResult.sketches[i]`. */
export interface SketchInfo extends SolvedSketch {
  /** IR path of the node built from the sketch (the extrude / revolve / ... or its region union). */
  path: string;
  /** Row-major 4×4: sketch `(x, y, 0, 1)` → model space (includes every enclosing transform). */
  plane: number[];
}

// ---------------------------------------------------------------------------------------------
// Tags

const ENTITY_TAGS = new Set(["point", "line", "arc", "spline"]);
const CONSTRAINT_ELEMENT_TAGS = new Set([
  "dimension", "distance", "angle", "coincident", "equal", "parallel", "perpendicular", "tangent", "collinear",
  "concentric", "horizontal", "vertical", "symmetric", "midpoint", "onCurve", "fix",
]);
/** Every tag that only exists in constraint sketches. */
export const CONSTRAINT_TAGS: ReadonlySet<string> = new Set([...ENTITY_TAGS, ...CONSTRAINT_ELEMENT_TAGS]);

function isSolvedCircle(h: Host): boolean {
  const p = h.props;
  return h.tag === "circle" && (p.center !== undefined || p.tangent !== undefined || p.equal !== undefined || p.concentric !== undefined);
}

/** Does this `<sketch>` hold constraint-sketch elements (and so needs solving)? */
export function isConstrainedSketch(h: Host): boolean {
  return h.children.some((c) => CONSTRAINT_TAGS.has(c.tag) || isSolvedCircle(c));
}

// ---------------------------------------------------------------------------------------------
// Model

interface Pt {
  kind: "point";
  name: string;
  ix: number;
  host?: Host;
}
interface LineE {
  kind: "line";
  name: string;
  id?: string;
  a: Pt;
  b: Pt;
  construction: boolean;
  host: Host;
}
interface ArcE {
  kind: "arc";
  name: string;
  id?: string;
  c: Pt;
  s: Pt;
  e: Pt;
  ir: number;
  ccw: boolean;
  ccwExplicit: boolean;
  construction: boolean;
  host: Host;
}
interface CircleE {
  kind: "circle";
  name: string;
  id?: string;
  c: Pt;
  ir: number;
  construction: boolean;
  host: Host;
}
interface SplineE {
  kind: "spline";
  name: string;
  id?: string;
  pts: Pt[];
  degree: number;
  construction: boolean;
  host: Host;
}
type Curve = LineE | ArcE | CircleE | SplineE;
type Round = ArcE | CircleE;
type Thing = Pt | Curve;

type DimKind = SketchDimensionInfo["kind"];
interface Dim {
  kind: DimKind;
  value: number;
}

type SpecBody =
  | { k: "fix"; p: Pt; at?: Vec2 }
  | { k: "coincident"; p: Pt; q: Pt }
  | { k: "hv"; p: Pt; q: Pt; axis: 0 | 1 }
  | { k: "dist"; p: Pt; q: Pt; v: number }
  | { k: "dxy"; p: Pt; q: Pt; axis: 0 | 1; v: number }
  | { k: "ptLine"; p: Pt; l: LineE; v: number; side?: 1 | -1 }
  | { k: "lineLine"; l1: LineE; l2: LineE; v: number; side?: 1 | -1 }
  | { k: "angAbs"; l: LineE; v: number }
  | { k: "ang"; l1: LineE; l2: LineE; v: number }
  | { k: "angle"; l1: LineE; l2: LineE; v: number; f1: boolean; f2: boolean }
  | { k: "eqLen"; l1: LineE; l2: LineE }
  | { k: "eqRad"; c1: Round; c2: Round }
  | { k: "radius"; c: Round; v: number }
  | { k: "sweep"; a: ArcE; v: number }
  | { k: "tanLC"; l: LineE; c: Round }
  | { k: "tanCC"; c1: Round; c2: Round }
  | { k: "onCircle"; p: Pt; c: Round }
  | { k: "midpoint"; p: Pt; l: LineE }
  | { k: "symLine"; p: Pt; q: Pt; l: LineE }
  | { k: "symPt"; p: Pt; q: Pt; m: Pt }
  | { k: "symAxis"; p: Pt; q: Pt; m: Pt | null; axis: 0 | 1 };
type Spec = SpecBody & { host: Host; label: string; structural?: boolean; dim?: Dim };

const DEG = Math.PI / 180;
const fmt = (v: number) => String(Number(v.toFixed(6)));

class Model {
  readonly x: number[] = [];
  readonly points: Pt[] = [];
  readonly pointsById = new Map<string, Pt>();
  readonly curves: Curve[] = [];
  readonly curvesById = new Map<string, Curve>();
  readonly specs: Spec[] = [];
  readonly decls = new Map<string, Host>();
  readonly building = new Set<string>();
  /** Points pinned by `fixed` / `<fix>`. */
  readonly fixed = new Set<Pt>();
  anon = 0;

  constructor(readonly sketch: Host) {}

  fail(h: Host | undefined, message: string, hint?: string): never {
    const loc = h?.loc ?? this.sketch.loc;
    throw new TscadError(message, { ...(loc ? { loc } : {}), ...(hint ? { hint } : {}) });
  }

  newVar(v = NaN): number {
    this.x.push(v);
    return this.x.length - 1;
  }

  newPoint(name: string, guess?: Vec2, host?: Host): Pt {
    const ix = this.newVar(guess?.[0]);
    this.newVar(guess?.[1]);
    const p: Pt = { kind: "point", name, ix, ...(host ? { host } : {}) };
    this.points.push(p);
    return p;
  }

  // ---- references

  /** A point reference; `create` makes unknown ids (and `[x, y]`) into new points. */
  point(ref: unknown, h: Host, prop: string, create: boolean): Pt {
    if (Array.isArray(ref)) {
      if (ref.length !== 2 || !ref.every((v) => typeof v === "number" && Number.isFinite(v))) this.fail(h, `${prop} must be a point id or [x, y] (got ${show(ref)})`);
      if (!create) this.fail(h, `${prop} must name a point (an id string), not coordinates`);
      return this.newPoint(`(${fmt(ref[0])}, ${fmt(ref[1])})`, [ref[0], ref[1]]);
    }
    if (typeof ref !== "string" || ref === "") this.fail(h, `${prop} must be a point id${create ? " or [x, y]" : ""} (got ${show(ref)})`);
    const dot = ref.lastIndexOf(".");
    if (dot > 0 && !this.pointsById.has(ref)) {
      const base = ref.slice(0, dot), sub = ref.slice(dot + 1);
      if (["start", "end", "from", "to", "center"].includes(sub) && (this.building.has(base) || (this.decls.has(base) && !this.curvesById.has(base)))) {
        // a curve's point referenced before the curve is built (a closed chain of curves naming
        // each other's ends): a placeholder, joined to the real point when the curve is built
        const key = `${base}.${sub === "from" ? "start" : sub === "to" ? "end" : sub}`;
        let ph = this.pointsById.get(key);
        if (!ph) this.pointsById.set(key, (ph = this.newPoint(key)));
        return ph;
      }
      const c = this.curve(base, h, prop);
      const pick = sub === "start" || sub === "from" ? startOf(c) : sub === "end" || sub === "to" ? endOf(c) : sub === "center" ? centerOf(c) : undefined;
      if (!pick) this.fail(h, `${prop}: a ${c.kind} has no point ".${sub}"`, c.kind === "circle" ? `use "${base}.center"` : `use "${base}.start"${c.kind === "arc" ? `, "${base}.end" or "${base}.center"` : ` or "${base}.end"`}`);
      return pick;
    }
    const p = this.pointsById.get(ref);
    if (p) return p;
    if (this.decls.has(ref)) this.fail(h, `${prop}="${ref}" is a ${this.decls.get(ref)!.tag}, not a point`, `use "${ref}.start" / "${ref}.end"${this.decls.get(ref)!.tag !== "line" ? ` / "${ref}.center"` : ""}`);
    if (!create) {
      const guess = closest(ref, [...this.pointsById.keys(), ...this.decls.keys()]);
      this.fail(h, `unknown point "${ref}"`, guess ? `did you mean "${guess}"?` : "points are created by <point id=...> or by naming them in a line's from/to");
    }
    const np = this.newPoint(ref);
    this.pointsById.set(ref, np);
    return np;
  }

  /** An entity by id (built on demand so references may come before declarations). */
  curve(id: string, h: Host, prop: string): Curve {
    const c = this.curvesById.get(id);
    if (c) return c;
    const decl = this.decls.get(id);
    if (!decl) {
      if (this.pointsById.has(id)) this.fail(h, `${prop}="${id}" is a point, not a line/arc/circle`);
      const guess = closest(id, [...this.decls.keys()]);
      if (id.includes(REF_MARK)) this.fail(h, `${prop}: handle .${id} is used but never attached in this sketch`, `attach it to a curve with ref: <line ref={….${id}} …/> (or <arc>/<circle>), or check the property name`);
      this.fail(h, `unknown sketch entity "${id}"`, guess ? `did you mean "${guess}"?` : "give the line/arc/circle an id");
    }
    if (this.building.has(id)) this.fail(h, `"${id}" refers to itself through its own points`);
    return this.build(decl);
  }

  /** A point or a curve. */
  thing(ref: unknown, h: Host, prop: string): Thing {
    if (typeof ref === "string" && (this.decls.has(ref) || this.curvesById.has(ref))) return this.curve(ref, h, prop);
    return this.point(ref, h, prop, false);
  }

  line(ref: unknown, h: Host, prop: string): LineE {
    if (typeof ref !== "string") this.fail(h, `${prop} must be a line id (got ${show(ref)})`);
    const c = this.curve(ref, h, prop);
    if (c.kind !== "line") this.fail(h, `${prop}="${ref}" is a ${c.kind}, not a line`);
    return c;
  }
  round(ref: unknown, h: Host, prop: string): Round {
    if (typeof ref !== "string") this.fail(h, `${prop} must be an arc or circle id (got ${show(ref)})`);
    const c = this.curve(ref, h, prop);
    if (c.kind !== "arc" && c.kind !== "circle") this.fail(h, `${prop}="${ref}" is a ${c.kind}, not an arc or circle`);
    return c;
  }

  // ---- building entities

  build(h: Host): Curve {
    const p = h.props;
    const id: string | undefined = p.id;
    if (id) this.building.add(id);
    const name = id ? `${h.tag} "${id}"` : `${h.tag} #${this.curves.length + 1}`;
    const construction = p.construction === true;
    let c: Curve;
    switch (h.tag) {
      case "line": {
        if (p.from === undefined || p.to === undefined) this.fail(h, "needs from and to", `<line from="a" to="b" />`);
        const a = this.point(p.from, h, "from", true);
        const b = this.point(p.to, h, "to", true);
        if (a === b) this.fail(h, "from and to are the same point");
        c = { kind: "line", name, ...(id ? { id } : {}), a, b, construction, host: h };
        break;
      }
      case "arc": {
        if (p.from === undefined || p.to === undefined) this.fail(h, "needs from and to", `<arc from="a" to="b" center="c" /> or <arc from="a" to="b" radius={5} tangent />`);
        const s = this.point(p.from, h, "from", true);
        const e = this.point(p.to, h, "to", true);
        const ctr = p.center !== undefined ? this.point(p.center, h, "center", true) : this.newPoint(`${id ?? name}.center`);
        if (ctr === s || ctr === e) this.fail(h, "the centre can't be one of the arc's ends");
        if (p.cw && p.ccw) this.fail(h, "cw and ccw both given");
        const explicit = p.cw !== undefined || p.ccw !== undefined;
        c = { kind: "arc", name, ...(id ? { id } : {}), c: ctr, s, e, ir: this.newVar(), ccw: p.cw ? false : p.ccw === false ? false : true, ccwExplicit: explicit, construction, host: h };
        break;
      }
      case "circle": {
        let ctr: Pt;
        if (p.center !== undefined) ctr = this.point(p.center, h, "center", true);
        else {
          const at = Array.isArray(p.at) ? p.at : undefined;
          const gx = (at?.[0] ?? 0) + (num(p.x) ?? 0), gy = (at?.[1] ?? 0) + (num(p.y) ?? 0);
          const has = at !== undefined || p.x !== undefined || p.y !== undefined;
          ctr = this.newPoint(`${id ?? name}.center`, has ? [gx, gy] : undefined);
        }
        c = { kind: "circle", name, ...(id ? { id } : {}), c: ctr, ir: this.newVar(), construction, host: h };
        if (p.fixed) this.fixed.add(ctr);
        break;
      }
      case "spline": {
        const ps = p.points;
        if (!Array.isArray(ps) || ps.length < 2) this.fail(h, "needs at least 2 points", `<spline points={["a", [10, 5], "b"]} />`);
        const pts = ps.map((r, i) => this.point(r, h, `points[${i}]`, true));
        const deg = num(p.degree) ?? 3;
        if (!Number.isInteger(deg) || deg < 1) this.fail(h, `degree must be a whole number ≥ 1 (got ${show(p.degree)})`);
        c = { kind: "spline", name, ...(id ? { id } : {}), pts, degree: Math.min(deg, pts.length - 1), construction, host: h };
        break;
      }
      default:
        return this.fail(h, `<${h.tag}> is not a sketch curve`);
    }
    if (id) {
      for (const [sub, pt] of [["start", startOf(c)], ["end", endOf(c)], ["center", centerOf(c)]] as const) {
        const ph = this.pointsById.get(`${id}.${sub}`);
        if (pt && ph && ph !== pt) this.add({ k: "coincident", p: ph, q: pt, host: h, label: `${name} (${sub})`, structural: true });
      }
      this.building.delete(id);
      this.curvesById.set(id, c);
    }
    this.curves.push(c);
    return c;
  }

  add(spec: Spec): void {
    this.specs.push(spec);
  }
}

function startOf(c: Curve): Pt | undefined {
  return c.kind === "line" ? c.a : c.kind === "arc" ? c.s : c.kind === "spline" ? c.pts[0] : undefined;
}
function endOf(c: Curve): Pt | undefined {
  return c.kind === "line" ? c.b : c.kind === "arc" ? c.e : c.kind === "spline" ? c.pts[c.pts.length - 1] : undefined;
}
function centerOf(c: Curve): Pt | undefined {
  return c.kind === "arc" || c.kind === "circle" ? c.c : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function refs(v: unknown): string[] {
  if (v === undefined || v === null || v === false) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(String);
  return [];
}
function show(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** `<dimension a="h" b="base" distance=30>` */
function summary(h: Host): string {
  const parts = Object.entries(h.props)
    .filter(([k, v]) => k !== "key" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || Array.isArray(v)))
    .map(([k, v]) => (v === true ? k : typeof v === "string" ? (v.includes(REF_MARK) ? `${k}={${v}}` : `${k}="${v}"`) : `${k}=${typeof v === "number" ? fmt(v) : show(v)}`));
  return `<${h.tag}${parts.length ? " " + parts.join(" ") : ""}>`;
}

// ---------------------------------------------------------------------------------------------
// Elements → specs

/** Handles → their keys; `ref={handle}` → `id`. */
function normalize(m: Model, h: Host): Host {
  const props: Record<string, any> = {};
  const conv = (v: unknown): unknown => (isSketchRef(v) ? v.key : Array.isArray(v) ? v.map(conv) : v);
  for (const [k, v] of Object.entries(h.props)) {
    if (k === "ref") continue;
    props[k] = conv(v);
  }
  const ref = h.props.ref;
  if (ref !== undefined) {
    if (!isSketchRef(ref)) m.fail(h, `ref must be a sketch handle from sketchRefs() / sketchRef() (got ${show(ref)})`);
    if (h.props.id !== undefined) m.fail(h, "give either id or ref, not both");
    if (ref.key.includes(".")) m.fail(h, `ref={${ref.label}} is a derived point; attach a plain handle`);
    props.id = ref.key;
  }
  return { ...h, props };
}

function parse(sketch: Host, hooks: SolveHooks): { m: Model; rest: Host[] } {
  const m = new Model(sketch);
  const rest: Host[] = [];
  const entities: Host[] = [];
  const order: Host[] = [];
  // declarations first so references can come before definitions
  for (const raw of sketch.children) {
    const solved = CONSTRAINT_TAGS.has(raw.tag) || raw.tag === "circle";
    const c = solved ? normalize(m, raw) : raw;
    if (c.tag === "point") {
      const p = c.props;
      const id = p.id;
      if (id !== undefined && (typeof id !== "string" || id === "")) m.fail(c, `id must be a non-empty string (got ${show(id)})`);
      if (id !== undefined && (m.pointsById.has(id) || m.decls.has(id))) m.fail(c, `duplicate id "${id}"`);
      const at = Array.isArray(p.at) ? p.at : undefined;
      const has = at !== undefined || p.x !== undefined || p.y !== undefined;
      for (const k of ["x", "y"]) if (p[k] !== undefined && num(p[k]) === undefined) m.fail(c, `${k} must be a finite number (got ${show(p[k])})`);
      const g: Vec2 | undefined = has ? [(at?.[0] ?? 0) + (num(p.x) ?? 0), (at?.[1] ?? 0) + (num(p.y) ?? 0)] : p.fixed ? [0, 0] : undefined;
      const pt = m.newPoint(id ?? `point #${m.points.length + 1}`, g, c);
      if (id) m.pointsById.set(id, pt);
      if (p.fixed) m.fixed.add(pt);
      order.push(c);
    } else if (ENTITY_TAGS.has(c.tag) || c.tag === "circle") {
      const id = c.props.id;
      if (id !== undefined) {
        if (typeof id !== "string" || id === "") m.fail(c, `id must be a non-empty string (got ${show(id)})`);
        if (m.decls.has(id) || m.pointsById.has(id)) m.fail(c, `duplicate id "${id}"`);
        m.decls.set(id, c);
      }
      entities.push(c);
      order.push(c);
    } else if (CONSTRAINT_ELEMENT_TAGS.has(c.tag)) order.push(c);
    else rest.push(c);
  }
  const built = new Map<Host, Curve>();
  for (const h of entities) {
    const id = h.props.id;
    built.set(h, id ? m.curve(id, h, "id") : m.build(h));
  }
  // structural equations
  for (const c of m.curves) {
    if (c.kind === "arc") {
      m.add({ k: "onCircle", p: c.s, c, host: c.host, label: `${c.name} (start on its circle)`, structural: true });
      m.add({ k: "onCircle", p: c.e, c, host: c.host, label: `${c.name} (end on its circle)`, structural: true });
    }
  }
  for (const p of m.fixed) m.add({ k: "fix", p, ...(guessOf(m, p) ? { at: guessOf(m, p)! } : {}), host: p.host ?? sketch, label: `fixed ${pname(p)}` });
  // constraints in source order
  for (const h of order) {
    if (h.tag === "point") pointProps(m, h);
    else if (built.has(h)) entityProps(m, built.get(h)!, h);
    else constraintElement(m, h);
  }
  // declared points nothing refers to are almost always a typo'd reference
  const used = new Set<Pt>();
  const mark = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    const o = v as { kind?: string };
    if (o.kind === "point") used.add(v as Pt);
    else if (o.kind === "line" || o.kind === "arc" || o.kind === "circle" || o.kind === "spline") {
      const c = v as Curve;
      for (const q of c.kind === "line" ? [c.a, c.b] : c.kind === "arc" ? [c.s, c.e, c.c] : c.kind === "circle" ? [c.c] : c.pts) used.add(q);
    }
  };
  for (const c of m.curves) mark(c);
  for (const sp of m.specs) if (!(sp.k === "fix" && sp.p.host === sp.host)) for (const v of Object.values(sp)) mark(v);
  for (const p of m.points) if (p.host && !used.has(p)) hooks.warn(p.host, `${pname(p)} is declared but nothing uses it`);
  return { m, rest };
}

function guessOf(m: Model, p: Pt): Vec2 | undefined {
  const x = m.x[p.ix]!, y = m.x[p.ix + 1]!;
  return Number.isNaN(x) || Number.isNaN(y) ? undefined : [x, y];
}
function pname(p: Pt): string {
  return `point "${p.name}"`;
}

function pointProps(m: Model, h: Host): void {
  const p = h.props;
  if (p.on === undefined) return;
  const pt = m.pointsById.get(p.id) ?? m.points.find((q) => q.host === h)!;
  onCurve(m, pt, m.curve(String(p.on), h, "on"), h, `${pname(pt)} on ${p.on}`);
}

function onCurve(m: Model, p: Pt, c: Curve, h: Host, label: string): void {
  if (c.kind === "line") m.add({ k: "ptLine", p, l: c, v: 0, host: h, label });
  else if (c.kind === "arc" || c.kind === "circle") m.add({ k: "onCircle", p, c, host: h, label });
  else m.fail(h, "a point can't be constrained onto a spline (only onto its control points)");
}

function lengthOrRadius(m: Model, h: Host, names: [string, string][]): [string, number] | undefined {
  for (const [n, kind] of names) {
    const v = h.props[n];
    if (v === undefined) continue;
    if (num(v) === undefined || !(v > 0)) m.fail(h, `${n} must be a number greater than 0 (got ${show(v)})`);
    return [kind, v];
  }
  return undefined;
}

/** The curve (other than `self`) meeting `p`. */
function meeting(m: Model, self: Curve, p: Pt): Curve | undefined {
  return m.curves.find((c) => c !== self && !c.construction && (startOf(c) === p || endOf(c) === p)) ?? m.curves.find((c) => c !== self && (startOf(c) === p || endOf(c) === p));
}

function tangent(m: Model, a: Curve, b: Curve, h: Host, label: string): void {
  if (a.kind === "spline" || b.kind === "spline") m.fail(h, "tangency to a spline isn't supported", "constrain the spline's control points instead");
  if (a.kind === "line" && b.kind === "line") m.fail(h, "two lines can't be tangent", "use parallel or collinear");
  if (a.kind === "line") m.add({ k: "tanLC", l: a, c: b as Round, host: h, label });
  else if (b.kind === "line") m.add({ k: "tanLC", l: b, c: a, host: h, label });
  else m.add({ k: "tanCC", c1: a, c2: b as Round, host: h, label });
}

function entityProps(m: Model, c: Curve, h: Host): void {
  const p = h.props;
  const on = (what: string) => `${what} on ${c.name}`;
  const tangents = (self: Curve, from: Pt) => {
    if (p.tangent === undefined || p.tangent === false) return;
    const list = p.tangent === true ? [] : refs(p.tangent);
    if (p.tangent === true) {
      const other = meeting(m, self, from);
      if (!other) m.fail(h, "tangent: no other curve meets this one's start point", `name it: tangent="otherId"`);
      tangent(m, self, other, h, on(`tangent (to ${other.name})`));
    }
    for (const r of list) tangent(m, self, m.curve(r, h, "tangent"), h, on(`tangent="${r}"`));
  };
  const equals = () => {
    for (const r of refs(p.equal)) {
      const o = m.curve(r, h, "equal");
      if (c.kind === "line" && o.kind === "line") m.add({ k: "eqLen", l1: c, l2: o, host: h, label: on(`equal="${r}"`) });
      else if ((c.kind === "arc" || c.kind === "circle") && (o.kind === "arc" || o.kind === "circle")) m.add({ k: "eqRad", c1: c, c2: o, host: h, label: on(`equal="${r}"`) });
      else m.fail(h, `equal="${r}": can't compare a ${c.kind} with a ${o.kind}`, "equal relates lines (length) or arcs/circles (radius)");
    }
  };
  const concentric = (self: Round) => {
    if (p.concentric === undefined) return;
    const o = m.round(p.concentric, h, "concentric");
    m.add({ k: "coincident", p: self.c, q: o.c, host: h, label: on(`concentric="${p.concentric}"`) });
  };
  const radius = (self: Round) => {
    const r = lengthOrRadius(m, h, [["radius", "radius"], ["r", "radius"], ["diameter", "diameter"], ["d", "diameter"]]);
    if (!r) return;
    const v = r[0] === "diameter" ? r[1] / 2 : r[1];
    m.add({ k: "radius", c: self, v, host: h, label: on(`${r[0]}=${fmt(r[1])}`), dim: { kind: r[0] as DimKind, value: r[1] } });
  };
  switch (c.kind) {
    case "line": {
      if (p.horizontal && p.vertical) m.fail(h, "a line can't be both horizontal and vertical");
      if (p.horizontal) m.add({ k: "hv", p: c.a, q: c.b, axis: 0, host: h, label: on("horizontal") });
      if (p.vertical) m.add({ k: "hv", p: c.a, q: c.b, axis: 1, host: h, label: on("vertical") });
      if (p.length !== undefined) {
        const v = num(p.length);
        if (v === undefined || !(v > 0)) m.fail(h, `length must be a number greater than 0 (got ${show(p.length)})`);
        m.add({ k: "dist", p: c.a, q: c.b, v, host: h, label: on(`length=${fmt(v)}`), dim: { kind: "length", value: v } });
      }
      if (p.angle !== undefined) {
        const v = num(p.angle);
        if (v === undefined) m.fail(h, `angle must be a number of degrees (got ${show(p.angle)})`);
        m.add({ k: "angAbs", l: c, v: v * DEG, host: h, label: on(`angle=${fmt(v)}`), dim: { kind: "angle", value: v } });
      }
      for (const r of refs(p.parallel)) m.add({ k: "ang", l1: c, l2: m.line(r, h, "parallel"), v: 0, host: h, label: on(`parallel="${r}"`) });
      for (const r of refs(p.perpendicular)) m.add({ k: "ang", l1: c, l2: m.line(r, h, "perpendicular"), v: Math.PI / 2, host: h, label: on(`perpendicular="${r}"`) });
      equals();
      tangents(c, c.a);
      break;
    }
    case "arc": {
      radius(c);
      if (p.angle !== undefined) {
        const v = num(p.angle);
        if (v === undefined || !(v > 0 && v < 360)) m.fail(h, `angle (the arc's sweep) must be between 0 and 360 degrees (got ${show(p.angle)})`);
        m.add({ k: "sweep", a: c, v: v * DEG, host: h, label: on(`angle=${fmt(v)}`), dim: { kind: "sweep", value: v } });
      }
      equals();
      concentric(c);
      tangents(c, c.s);
      break;
    }
    case "circle": {
      radius(c);
      equals();
      concentric(c);
      for (const r of refs(p.tangent)) tangent(m, c, m.curve(r, h, "tangent"), h, on(`tangent="${r}"`));
      break;
    }
    case "spline":
      break;
  }
}

function asPoint(m: Model, t: Thing, h: Host, prop: string): Pt {
  if (t.kind === "point") return t;
  const c = centerOf(t);
  if (c) return c;
  return m.fail(h, `${prop} must be a point (or an arc/circle, meaning its centre), not a ${t.kind}`);
}

function constraintElement(m: Model, h: Host): void {
  const p = h.props;
  const label = summary(h);
  const A = p.a ?? p.from, B = p.b ?? p.to;
  const two = (what: string): [Thing, Thing] => {
    if (A === undefined || B === undefined) m.fail(h, `needs a and b (${what})`, `<${h.tag} a="..." b="..." />`);
    return [m.thing(A, h, "a"), m.thing(B, h, "b")];
  };
  const lineList = (): LineE[] => (p.of !== undefined ? refs(p.of) : [A, B].filter((v) => v !== undefined)).map((r, i) => m.line(r, h, p.of !== undefined ? `of[${i}]` : i ? "b" : "a"));
  switch (h.tag) {
    case "coincident": {
      const [a, b] = two("two points, or a point and a curve");
      if (a.kind === "point" && b.kind === "point") m.add({ k: "coincident", p: a, q: b, host: h, label });
      else if (a.kind === "point") onCurve(m, a, b as Curve, h, label);
      else if (b.kind === "point") onCurve(m, b, a, h, label);
      else m.fail(h, "relates two points, or a point and a curve", `<coincident a="p" b="q" />`);
      return;
    }
    case "dimension":
    case "distance": {
      if (p.of !== undefined && h.tag === "dimension") {
        const c = m.curve(String(p.of), h, "of");
        const r = lengthOrRadius(m, h, [["radius", "radius"], ["diameter", "diameter"], ["length", "length"], ["distance", "length"], ["value", "length"]]);
        if (!r) m.fail(h, "needs a value", `<dimension of="hole" diameter={10} /> or <dimension of="base" length={40} />`);
        if (r[0] === "length") {
          if (c.kind !== "line") m.fail(h, `length needs a line (${c.name} is a ${c.kind})`);
          m.add({ k: "dist", p: c.a, q: c.b, v: r[1], host: h, label, dim: { kind: "length", value: r[1] } });
        } else {
          if (c.kind !== "arc" && c.kind !== "circle") m.fail(h, `${r[0]} needs an arc or circle (${c.name} is a ${c.kind})`);
          m.add({ k: "radius", c, v: r[0] === "diameter" ? r[1] / 2 : r[1], host: h, label, dim: { kind: r[0] as DimKind, value: r[1] } });
        }
        return;
      }
      if (h.tag === "dimension" && p.angle !== undefined) return angleEl(m, h, label);
      const [a, b] = two("the two things to measure between");
      let any = false;
      for (const [key, axis] of [["dx", 0], ["dy", 1]] as const) {
        if (p[key] === undefined) continue;
        const v = num(p[key]);
        if (v === undefined) m.fail(h, `${key} must be a number (got ${show(p[key])})`);
        m.add({ k: "dxy", p: asPoint(m, a, h, "a"), q: asPoint(m, b, h, "b"), axis, v, host: h, label, dim: { kind: key, value: v } });
        any = true;
      }
      const raw = p.distance ?? p.value;
      if (raw === undefined) {
        if (!any) m.fail(h, "needs a value", `<${h.tag} a="p" b="q" ${h.tag === "dimension" ? "distance" : "value"}={20} />`);
        return;
      }
      const v = num(raw);
      if (v === undefined || v < 0) m.fail(h, `distance must be a number ≥ 0 (got ${show(raw)})`);
      const dim: Dim = { kind: "distance", value: v };
      /** `side`: which side of the line (seen along from → to) the other thing lies. */
      const side = (): { side?: 1 | -1 } => {
        if (p.side === undefined) return {};
        if (p.side !== "left" && p.side !== "right") m.fail(h, `side must be "left" or "right" (got ${show(p.side)})`);
        if (a.kind !== "line" && b.kind !== "line") m.fail(h, "side only applies to a distance from a line", `<dimension a="p" b="someLine" distance={5} side="left" />`);
        return { side: p.side === "left" ? 1 : -1 };
      };
      if (a.kind === "line" && b.kind === "line") {
        if (v === 0) m.fail(h, "distance 0 between lines", "use <collinear>");
        m.add({ k: "lineLine", l1: a, l2: b, v, ...side(), host: h, label, dim });
      } else if (a.kind === "line" || b.kind === "line") {
        const l = (a.kind === "line" ? a : b) as LineE;
        const o = a.kind === "line" ? b : a;
        m.add({ k: "ptLine", p: asPoint(m, o, h, a.kind === "line" ? "b" : "a"), l, v, ...side(), host: h, label, dim });
      } else {
        const pa = asPoint(m, a, h, "a"), pb = asPoint(m, b, h, "b");
        if (pa === pb) m.fail(h, "measures a point to itself");
        if (v === 0) m.add({ k: "coincident", p: pa, q: pb, host: h, label });
        else m.add({ k: "dist", p: pa, q: pb, v, host: h, label, dim });
      }
      return;
    }
    case "angle":
      return angleEl(m, h, label);
    case "equal": {
      const ids = p.of !== undefined ? refs(p.of) : [A, B].filter((v) => v !== undefined).map(String);
      if (ids.length < 2) m.fail(h, "needs two or more things", `<equal a="l1" b="l2" /> or <equal of={["a", "b", "c"]} />`);
      const cs = ids.map((r) => m.curve(r, h, "equal"));
      for (const c of cs.slice(1)) {
        const f = cs[0]!;
        if (f.kind === "line" && c.kind === "line") m.add({ k: "eqLen", l1: f, l2: c, host: h, label });
        else if ((f.kind === "arc" || f.kind === "circle") && (c.kind === "arc" || c.kind === "circle")) m.add({ k: "eqRad", c1: f, c2: c, host: h, label });
        else m.fail(h, `can't make a ${f.kind} equal to a ${c.kind}`, "equal relates lines (length) or arcs/circles (radius)");
      }
      return;
    }
    case "parallel":
    case "perpendicular": {
      const ls = lineList();
      if (ls.length < 2) m.fail(h, "needs two lines", `<${h.tag} a="l1" b="l2" />`);
      for (const l of ls.slice(1)) m.add({ k: "ang", l1: ls[0]!, l2: l, v: h.tag === "parallel" ? 0 : Math.PI / 2, host: h, label });
      return;
    }
    case "collinear": {
      const ls = lineList();
      if (ls.length < 2) m.fail(h, "needs two lines");
      for (const l of ls.slice(1)) {
        m.add({ k: "ptLine", p: l.a, l: ls[0]!, v: 0, host: h, label });
        m.add({ k: "ptLine", p: l.b, l: ls[0]!, v: 0, host: h, label });
      }
      return;
    }
    case "tangent": {
      const [a, b] = two("a line and an arc/circle, or two arcs/circles");
      if (a.kind === "point" || b.kind === "point") m.fail(h, "relates curves, not points");
      tangent(m, a, b, h, label);
      return;
    }
    case "concentric": {
      const [a, b] = two("two arcs/circles");
      m.add({ k: "coincident", p: asPoint(m, a, h, "a"), q: asPoint(m, b, h, "b"), host: h, label });
      return;
    }
    case "horizontal":
    case "vertical": {
      const axis = h.tag === "horizontal" ? 0 : 1;
      if (A === undefined) m.fail(h, "needs a (a line) or a and b (two points)");
      if (B === undefined) {
        const l = m.line(A, h, "a");
        m.add({ k: "hv", p: l.a, q: l.b, axis, host: h, label });
      } else m.add({ k: "hv", p: asPoint(m, m.thing(A, h, "a"), h, "a"), q: asPoint(m, m.thing(B, h, "b"), h, "b"), axis, host: h, label });
      return;
    }
    case "symmetric": {
      const [a, b] = two("the two mirrored points");
      const pa = asPoint(m, a, h, "a"), pb = asPoint(m, b, h, "b");
      if (p.axis !== undefined && p.axis !== "x" && p.axis !== "y") m.fail(h, `axis must be "x" or "y" (got ${show(p.axis)})`);
      const about = p.about !== undefined ? m.thing(p.about, h, "about") : undefined;
      if (p.axis !== undefined) {
        const mid = about ? asPoint(m, about, h, "about") : null;
        m.add({ k: "symAxis", p: pa, q: pb, m: mid, axis: p.axis === "x" ? 0 : 1, host: h, label });
      } else if (about?.kind === "line") m.add({ k: "symLine", p: pa, q: pb, l: about, host: h, label });
      else if (about) m.add({ k: "symPt", p: pa, q: pb, m: asPoint(m, about, h, "about"), host: h, label });
      else m.fail(h, "needs about (a line or point) or axis", `<symmetric a="p" b="q" about="centerline" /> or <symmetric a="p" b="q" axis="x" />`);
      return;
    }
    case "midpoint": {
      if (p.point === undefined || p.of === undefined) m.fail(h, "needs point and of", `<midpoint point="m" of="base" />`);
      m.add({ k: "midpoint", p: m.point(p.point, h, "point", false), l: m.line(p.of, h, "of"), host: h, label });
      return;
    }
    case "onCurve": {
      if (p.point === undefined || p.curve === undefined) m.fail(h, "needs point and curve", `<onCurve point="p" curve="base" />`);
      onCurve(m, m.point(p.point, h, "point", false), m.curve(String(p.curve), h, "curve"), h, label);
      return;
    }
    case "fix": {
      const ref = p.point ?? p.a;
      if (ref === undefined) m.fail(h, "needs point", `<fix point="o" x={0} y={0} />`);
      const pt = asPoint(m, m.thing(ref, h, "point"), h, "point");
      const g = guessOf(m, pt);
      const x = num(p.x), y = num(p.y);
      if ((x === undefined) !== (y === undefined) && !g) m.fail(h, "give both x and y (the point has no drawn position)");
      const at: Vec2 | undefined = x !== undefined || y !== undefined ? [x ?? g![0], y ?? g![1]] : g;
      if (at) {
        m.x[pt.ix] = at[0];
        m.x[pt.ix + 1] = at[1];
      }
      m.add({ k: "fix", p: pt, ...(at ? { at } : {}), host: h, label });
      return;
    }
  }
}

function angleEl(m: Model, h: Host, label: string): void {
  const p = h.props;
  const A = p.a ?? p.from, B = p.b ?? p.to;
  if (A === undefined || B === undefined) m.fail(h, "needs two lines a and b", `<${h.tag} a="l1" b="l2" angle={30} />`);
  const raw = p.angle ?? p.value;
  const v = num(raw);
  if (v === undefined) m.fail(h, `needs an angle in degrees (got ${show(raw)})`);
  const l1 = m.line(A, h, "a"), l2 = m.line(B, h, "b");
  // rays leave the shared vertex when the lines meet; otherwise they point from → to
  const f1 = l1.b === l2.a || l1.b === l2.b, f2 = l2.b === l1.a || l2.b === l1.b;
  m.add({ k: "angle", l1, l2, v: v * DEG, f1, f2, host: h, label, dim: { kind: "angle", value: v } });
}

// ---------------------------------------------------------------------------------------------
// Initial guess: chain layout

const rotL = (v: Vec2): Vec2 => [-v[1], v[0]];
const rotR = (v: Vec2): Vec2 => [v[1], -v[0]];
const vsub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const vadd = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const vsc = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const vlen = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (a: Vec2): Vec2 => {
  const l = vlen(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [1, 0];
};
const vdot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const rotAbout = (p: Vec2, c: Vec2, t: number): Vec2 => {
  const v = vsub(p, c), cs = Math.cos(t), sn = Math.sin(t);
  return [c[0] + v[0] * cs - v[1] * sn, c[1] + v[0] * sn + v[1] * cs];
};

function layout(m: Model): void {
  const x = m.x;
  const known = (p: Pt) => !Number.isNaN(x[p.ix]!) && !Number.isNaN(x[p.ix + 1]!);
  const get = (p: Pt): Vec2 => [x[p.ix]!, x[p.ix + 1]!];
  const set = (p: Pt, v: Vec2) => {
    x[p.ix] = v[0];
    x[p.ix + 1] = v[1];
  };
  for (const s of m.specs) if (s.k === "fix" && s.at && !known(s.p)) set(s.p, s.at);

  // characteristic length: dimension values, else the drawn extent, else 10
  const vals = m.specs.flatMap((s) => ("v" in s && s.k !== "ang" && s.k !== "angle" && s.k !== "angAbs" && s.k !== "sweep" && s.v > 0 ? [s.k === "radius" ? s.v * 2 : s.v] : [])).sort((a, b) => a - b);
  const kn = m.points.filter(known).map(get);
  const ext = kn.length > 1 ? Math.hypot(Math.max(...kn.map((p) => p[0])) - Math.min(...kn.map((p) => p[0])), Math.max(...kn.map((p) => p[1])) - Math.min(...kn.map((p) => p[1]))) : 0;
  const L0 = vals.length ? vals[vals.length >> 1]! : ext > 0 ? ext / 2 : 10;

  const lengthOf = new Map<LineE, number>();
  const radiusOf = new Map<Round, number>();
  const sweepOf = new Map<ArcE, number>();
  for (const s of m.specs) {
    if (s.k === "dist") {
      const l = m.curves.find((c): c is LineE => c.kind === "line" && ((c.a === s.p && c.b === s.q) || (c.a === s.q && c.b === s.p)));
      if (l) lengthOf.set(l, s.v);
    } else if (s.k === "radius") radiusOf.set(s.c, s.v);
    else if (s.k === "sweep") sweepOf.set(s.a, s.v);
  }
  for (let pass = 0; pass < 4; pass++)
    for (const s of m.specs) {
      if (s.k === "eqLen") {
        if (lengthOf.has(s.l1) && !lengthOf.has(s.l2)) lengthOf.set(s.l2, lengthOf.get(s.l1)!);
        if (lengthOf.has(s.l2) && !lengthOf.has(s.l1)) lengthOf.set(s.l1, lengthOf.get(s.l2)!);
      } else if (s.k === "eqRad") {
        if (radiusOf.has(s.c1) && !radiusOf.has(s.c2)) radiusOf.set(s.c2, radiusOf.get(s.c1)!);
        if (radiusOf.has(s.c2) && !radiusOf.has(s.c1)) radiusOf.set(s.c1, radiusOf.get(s.c2)!);
      }
    }
  const tangentPairs = new Set<string>();
  const curveIndex = new Map(m.curves.map((c, i) => [c, i]));
  for (const s of m.specs) {
    if (s.k === "tanLC") tangentPairs.add(`${curveIndex.get(s.l)},${curveIndex.get(s.c)}`), tangentPairs.add(`${curveIndex.get(s.c)},${curveIndex.get(s.l)}`);
    if (s.k === "tanCC") tangentPairs.add(`${curveIndex.get(s.c1)},${curveIndex.get(s.c2)}`), tangentPairs.add(`${curveIndex.get(s.c2)},${curveIndex.get(s.c1)}`);
  }
  const isTangent = (a: Curve, b: Curve) => tangentPairs.has(`${curveIndex.get(a)},${curveIndex.get(b)}`);

  /** Direction of motion arriving at `p` along another curve (whose geometry is known). */
  const arriving = (p: Pt, self: Curve): { t: Vec2; smooth: boolean } | undefined => {
    let best: { t: Vec2; smooth: boolean } | undefined;
    for (const c of m.curves) {
      if (c === self) continue;
      let t: Vec2 | undefined;
      if (c.kind === "line") {
        const other = c.a === p ? c.b : c.b === p ? c.a : undefined;
        if (other && known(other) && known(p)) t = unit(vsub(get(p), get(other)));
      } else if (c.kind === "arc" && (c.s === p || c.e === p) && known(c.c) && known(p)) {
        const rad = vsub(get(p), get(c.c));
        const travel = unit(c.ccw ? rotL(rad) : rotR(rad));
        t = c.e === p ? travel : vsc(travel, -1);
      } else if (c.kind === "spline") {
        const i = c.pts.indexOf(p);
        const nb = i === 0 ? c.pts[1] : i === c.pts.length - 1 ? c.pts[i - 1] : undefined;
        if (nb && known(nb) && known(p)) t = unit(vsub(get(p), get(nb)));
      }
      if (!t) continue;
      const smooth = isTangent(self, c);
      if (!best || (smooth && !best.smooth)) best = { t, smooth };
    }
    return best;
  };

  const lineDirs = (l: LineE): Vec2[] | undefined => {
    for (const s of m.specs) {
      if (s.k === "hv" && ((s.p === l.a && s.q === l.b) || (s.p === l.b && s.q === l.a))) return s.axis === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
      if (s.k === "angAbs" && s.l === l) return [[Math.cos(s.v), Math.sin(s.v)]];
      if (s.k === "angle" && (s.l1 === l || s.l2 === l)) {
        const o = s.l1 === l ? s.l2 : s.l1;
        if (known(o.a) && known(o.b)) {
          // ray of the other line, rotated by ±v, is this line's ray
          const oflip = s.l1 === l ? s.f2 : s.f1, flip = s.l1 === l ? s.f1 : s.f2;
          const od = vsc(unit(vsub(get(o.b), get(o.a))), oflip ? -1 : 1);
          const t = s.l1 === l ? -s.v : s.v;
          const ray: Vec2 = [Math.cos(t) * od[0] - Math.sin(t) * od[1], Math.sin(t) * od[0] + Math.cos(t) * od[1]];
          return [flip ? vsc(ray, -1) : ray];
        }
      }
      if (s.k === "ang" && (s.l1 === l || s.l2 === l)) {
        const o = s.l1 === l ? s.l2 : s.l1;
        if (known(o.a) && known(o.b)) {
          const od = unit(vsub(get(o.b), get(o.a)));
          const t = s.l1 === l ? -s.v : s.v;
          const dd = [Math.cos(t) * od[0] - Math.sin(t) * od[1], Math.sin(t) * od[0] + Math.cos(t) * od[1]] as Vec2;
          return [dd, vsc(dd, -1)];
        }
      }
    }
    return undefined;
  };

  const placeLine = (l: LineE): boolean => {
    const ka = known(l.a), kb = known(l.b);
    if (ka === kb) return false;
    const K = ka ? l.a : l.b, U = ka ? l.b : l.a;
    const forward = ka;
    const arr = arriving(K, l);
    let w: Vec2 = arr ? (arr.smooth ? arr.t : forward ? rotL(arr.t) : rotR(arr.t)) : forward ? [1, 0] : [0, 1];
    const cands = lineDirs(l);
    if (cands) {
      const ws = cands.map((c) => (forward ? c : vsc(c, -1)));
      w = ws.reduce((a, b) => (vdot(b, w) > vdot(a, w) + 1e-9 ? b : a));
    }
    set(U, vadd(get(K), vsc(w, lengthOf.get(l) ?? L0)));
    return true;
  };

  const placeArc = (a: ArcE): boolean => {
    const r0 = radiusOf.get(a);
    const ks = known(a.s), ke = known(a.e), kc = known(a.c);
    const defaultSweep = () => sweepOf.get(a) ?? (m.specs.some((s) => (s.k === "tanLC" && s.c === a) || (s.k === "tanCC" && (s.c1 === a || s.c2 === a))) ? Math.PI : Math.PI / 2);
    if (kc && (ks || ke) && !(ks && ke)) {
      const t = defaultSweep() * (a.ccw ? 1 : -1);
      if (ks) set(a.e, rotAbout(get(a.s), get(a.c), t));
      else set(a.s, rotAbout(get(a.e), get(a.c), -t));
      return true;
    }
    if (kc && !ks && !ke) {
      // bulge away from the rest of the drawing (a slot end, a boss around its hole...)
      const C = get(a.c);
      const others = m.points.filter((q) => q !== a.c && known(q)).map(get);
      const cen: Vec2 = others.length ? [others.reduce((t, q) => t + q[0], 0) / others.length, others.reduce((t, q) => t + q[1], 0) / others.length] : [C[0] - 1, C[1]];
      const away = vlen(vsub(C, cen)) > 1e-9 ? unit(vsub(C, cen)) : ([1, 0] as Vec2);
      const half = (defaultSweep() / 2) * (a.ccw ? 1 : -1);
      const t0 = Math.atan2(away[1], away[0]) - half;
      const r = r0 ?? L0 / 2;
      set(a.s, [C[0] + r * Math.cos(t0), C[1] + r * Math.sin(t0)]);
      return true;
    }
    if (kc) return false;
    if (ks && ke) {
      const S = get(a.s), E = get(a.e), ch = vsub(E, S);
      const arr = arriving(a.s, a);
      if (arr) {
        const n = rotL(arr.t);
        const den = 2 * vdot(n, ch);
        if (Math.abs(den) > 1e-9 * vlen(ch)) {
          const lam = vdot(ch, ch) / den;
          set(a.c, vadd(S, vsc(n, lam)));
          if (!a.ccwExplicit) a.ccw = lam > 0;
          return true;
        }
      }
      const half = vlen(ch) / 2;
      const r = Math.max(r0 ?? half, half);
      const hgt = Math.sqrt(Math.max(0, r * r - half * half));
      set(a.c, vadd(vadd(S, vsc(ch, 0.5)), vsc(rotL(unit(ch)), a.ccw ? hgt : -hgt)));
      return true;
    }
    if (!ks && !ke) return false;
    // one end known: centre off the arriving tangent
    const fwd = ks;
    const K = fwd ? a.s : a.e, U = fwd ? a.e : a.s;
    const arr = arriving(K, a);
    const t = arr?.t ?? (fwd ? ([1, 0] as Vec2) : ([-1, 0] as Vec2));
    // walking from K: forward travels the arc as drawn; backward travels it reversed
    let ccwWalk = fwd ? a.ccw : !a.ccw;
    const r = r0 ?? L0 / 2;
    if (!a.ccwExplicit && known(U)) {
      ccwWalk = vdot(rotL(t), vsub(get(U), get(K))) >= 0;
      a.ccw = fwd ? ccwWalk : !ccwWalk;
    }
    const n = ccwWalk ? rotL(t) : rotR(t);
    const C = vadd(get(K), vsc(n, r));
    set(a.c, C);
    if (!known(U)) set(U, rotAbout(get(K), C, defaultSweep() * (ccwWalk ? 1 : -1)));
    return true;
  };

  let seeds = 0;
  for (let pass = 0; pass < 10 * (m.points.length + 1); pass++) {
    let progress = false;
    for (const s of m.specs) {
      if (s.k === "coincident") {
        if (known(s.p) && !known(s.q)) set(s.q, get(s.p)), (progress = true);
        else if (known(s.q) && !known(s.p)) set(s.p, get(s.q)), (progress = true);
      } else if (s.k === "midpoint" && !known(s.p) && known(s.l.a) && known(s.l.b)) {
        set(s.p, vsc(vadd(get(s.l.a), get(s.l.b)), 0.5));
        progress = true;
      } else if (s.k === "symPt" && known(s.m)) {
        if (known(s.p) && !known(s.q)) set(s.q, vsub(vsc(get(s.m), 2), get(s.p))), (progress = true);
        else if (known(s.q) && !known(s.p)) set(s.p, vsub(vsc(get(s.m), 2), get(s.q))), (progress = true);
      } else if (s.k === "symAxis" && (!s.m || known(s.m))) {
        const c = s.m ? get(s.m) : ([0, 0] as Vec2);
        const refl = (v: Vec2): Vec2 => (s.axis === 0 ? [2 * c[0] - v[0], v[1]] : [v[0], 2 * c[1] - v[1]]);
        if (known(s.p) && !known(s.q)) set(s.q, refl(get(s.p))), (progress = true);
        else if (known(s.q) && !known(s.p)) set(s.p, refl(get(s.q))), (progress = true);
      }
    }
    if (progress) continue;
    for (const c of m.curves) {
      if (c.kind === "line" && placeLine(c)) progress = true;
      else if (c.kind === "arc" && placeArc(c)) progress = true;
      else if (c.kind === "spline") {
        for (let i = 1; i < c.pts.length; i++) {
          const P = c.pts[i - 1]!, Q = c.pts[i]!;
          if (known(P) && !known(Q)) {
            const dir = i >= 2 && known(c.pts[i - 2]!) ? unit(vsub(get(P), get(c.pts[i - 2]!))) : ([1, 0] as Vec2);
            set(Q, vadd(get(P), vsc(dir, L0 / 2)));
            progress = true;
          } else if (!known(P) && known(Q)) {
            set(P, vsub(get(Q), [L0 / 2, 0]));
            progress = true;
          }
        }
      }
      if (progress) break; // re-run cheap propagation first
    }
    if (progress) continue;
    // seed a new chain: the first unknown point (curve order), near what's known
    const unknownPt = m.curves.flatMap((c) => (c.kind === "line" ? [c.a, c.b] : c.kind === "arc" ? [c.s, c.e, c.c] : c.kind === "circle" ? [c.c] : c.pts)).find((p) => !known(p)) ?? m.points.find((p) => !known(p));
    if (!unknownPt) break;
    const kps = m.points.filter(known).map(get);
    if (!kps.length) set(unknownPt, [0, 0]);
    else {
      const cx = kps.reduce((a, p) => a + p[0], 0) / kps.length, cy = kps.reduce((a, p) => a + p[1], 0) / kps.length;
      seeds++;
      const t = seeds * 2.399963; // golden angle: deterministic, distinct
      set(unknownPt, [cx + (L0 / 3) * Math.sqrt(seeds) * Math.cos(t), cy + (L0 / 3) * Math.sqrt(seeds) * Math.sin(t)]);
    }
  }
  // radii
  for (const c of m.curves) {
    if (c.kind === "arc") x[c.ir] = radiusOf.get(c) ?? (vlen(vsub(get(c.s), get(c.c))) + vlen(vsub(get(c.e), get(c.c)))) / 2;
    else if (c.kind === "circle") x[c.ir] = radiusOf.get(c) ?? L0 / 4;
  }
  for (const s of m.specs) if (s.k === "fix" && !s.at) s.at = get(s.p);
}

// ---------------------------------------------------------------------------------------------
// Specs → residual equations

function equations(m: Model, x0: Float64Array, S: number): Constraint[] {
  // points tied by coincident constraints count as one for tangency at a shared end
  const root = new Map<Pt, Pt>();
  const find = (p: Pt): Pt => {
    let r = p;
    while (root.has(r)) r = root.get(r)!;
    return r;
  };
  for (const s of m.specs) if (s.k === "coincident" && find(s.p) !== find(s.q)) root.set(find(s.p), find(s.q));
  const same = (p: Pt, q: Pt) => find(p) === find(q);
  return m.specs.map((s) => {
    const vars: number[] = [];
    const slot = new Map<number, number>();
    const V = (g: number) => {
      let i = slot.get(g);
      if (i === undefined) {
        i = vars.length;
        vars.push(g);
        slot.set(g, i);
      }
      return i;
    };
    const P = (p: Pt) => [V(p.ix), V(p.ix + 1)] as const;
    const at = (x: d.D[], i: readonly [number, number]): d.P => [x[i[0]]!, x[i[1]]!];
    const g = (p: Pt): Vec2 => [x0[p.ix]!, x0[p.ix + 1]!];
    const sd0 = (p: Vec2, l: LineE) => {
      const a = g(l.a), b = g(l.b), u = vsub(b, a);
      return (u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0])) / Math.max(vlen(u), 1e-300);
    };
    const sign = (v: number) => (v < 0 ? -1 : 1);
    /** Signed distance of point to line, as duals. */
    const sd = (p: d.P, a: d.P, b: d.P) => d.div(d.cross(d.vsub(b, a), d.vsub(p, a)), d.norm(d.vsub(b, a)));
    let ev: (x: d.D[]) => d.D[];
    switch (s.k) {
      case "fix": {
        const ip = P(s.p), A = s.at!;
        ev = (x) => [d.addc(x[ip[0]]!, -A[0]), d.addc(x[ip[1]]!, -A[1])];
        break;
      }
      case "coincident": {
        const ip = P(s.p), iq = P(s.q);
        ev = (x) => [d.sub(x[ip[0]]!, x[iq[0]]!), d.sub(x[ip[1]]!, x[iq[1]]!)];
        break;
      }
      case "hv": {
        const ip = P(s.p), iq = P(s.q), k = s.axis === 0 ? 1 : 0;
        ev = (x) => [d.sub(x[ip[k]]!, x[iq[k]]!)];
        break;
      }
      case "dist": {
        const ip = P(s.p), iq = P(s.q), v = s.v;
        ev = (x) => [d.addc(d.dist(at(x, ip), at(x, iq)), -v)];
        break;
      }
      case "dxy": {
        const ip = P(s.p), iq = P(s.q), k = s.axis, v = s.v;
        ev = (x) => [d.addc(d.sub(x[iq[k]]!, x[ip[k]]!), -v)];
        break;
      }
      case "ptLine": {
        const ip = P(s.p), ia = P(s.l.a), ib = P(s.l.b), v = s.v, sg = s.side ?? sign(sd0(g(s.p), s.l));
        ev = (x) => [v === 0 ? sd(at(x, ip), at(x, ia), at(x, ib)) : d.addc(d.sc(sd(at(x, ip), at(x, ia), at(x, ib)), sg), -v)];
        break;
      }
      case "lineLine": {
        const p1 = P(s.l1.a), p2 = P(s.l1.b), ia = P(s.l2.a), ib = P(s.l2.b), v = s.v;
        const mid0 = vsc(vadd(g(s.l1.a), g(s.l1.b)), 0.5);
        const sg = s.side ?? sign(sd0(mid0, s.l2));
        ev = (x) => [
          d.addc(d.sc(sd(at(x, p1), at(x, ia), at(x, ib)), sg), -v),
          d.addc(d.sc(sd(at(x, p2), at(x, ia), at(x, ib)), sg), -v),
        ];
        break;
      }
      case "angAbs": {
        const ia = P(s.l.a), ib = P(s.l.b), v = s.v;
        ev = (x) => {
          const u = d.vsub(at(x, ib), at(x, ia));
          return [d.sc(d.wrapPi(d.addc(d.atan2(u[1], u[0]), -v)), S)];
        };
        break;
      }
      case "ang": {
        const a1 = P(s.l1.a), b1 = P(s.l1.b), a2 = P(s.l2.a), b2 = P(s.l2.b), v = s.v;
        ev = (x) => {
          const u = d.vsub(at(x, b1), at(x, a1)), w = d.vsub(at(x, b2), at(x, a2));
          if (v === 0) return [d.sc(d.div(d.cross(u, w), d.mul(d.norm(u), d.norm(w))), S)];
          if (v === Math.PI / 2) return [d.sc(d.div(d.dot(u, w), d.mul(d.norm(u), d.norm(w))), S)];
          return [d.sc(d.wrapHalfPi(d.addc(d.atan2(d.cross(u, w), d.dot(u, w)), -v)), S)];
        };
        break;
      }
      case "angle": {
        const a1 = P(s.l1.a), b1 = P(s.l1.b), a2 = P(s.l2.a), b2 = P(s.l2.b), v = s.v, k1 = s.f1 ? -1 : 1, k2 = s.f2 ? -1 : 1;
        ev = (x) => {
          const u = d.vsub(at(x, b1), at(x, a1)), w = d.vsub(at(x, b2), at(x, a2));
          const uu: d.P = [d.sc(u[0], k1), d.sc(u[1], k1)], ww: d.P = [d.sc(w[0], k2), d.sc(w[1], k2)];
          return [d.sc(d.wrapPi(d.addc(d.atan2(d.cross(uu, ww), d.dot(uu, ww)), -v)), S)];
        };
        break;
      }
      case "eqLen": {
        const a1 = P(s.l1.a), b1 = P(s.l1.b), a2 = P(s.l2.a), b2 = P(s.l2.b);
        ev = (x) => [d.sub(d.dist(at(x, a1), at(x, b1)), d.dist(at(x, a2), at(x, b2)))];
        break;
      }
      case "eqRad": {
        const r1 = V(s.c1.ir), r2 = V(s.c2.ir);
        ev = (x) => [d.sub(x[r1]!, x[r2]!)];
        break;
      }
      case "radius": {
        const r = V(s.c.ir), v = s.v;
        ev = (x) => [d.addc(x[r]!, -v)];
        break;
      }
      case "sweep": {
        const ic = P(s.a.c), is = P(s.a.s), ie = P(s.a.e), v = s.v, dir = s.a.ccw ? 1 : -1;
        ev = (x) => {
          const u = d.vsub(at(x, is), at(x, ic)), w = d.vsub(at(x, ie), at(x, ic));
          return [d.sc(d.wrapPi(d.addc(d.sc(d.atan2(d.cross(u, w), d.dot(u, w)), dir), -v)), S)];
        };
        break;
      }
      case "tanLC": {
        const ia = P(s.l.a), ib = P(s.l.b), ic = P(s.c.c), r = V(s.c.ir);
        const shared = s.c.kind === "arc" ? [s.l.a, s.l.b].find((q) => same(q, (s.c as ArcE).s) || same(q, (s.c as ArcE).e)) : undefined;
        if (shared) {
          // the radius to the shared end is square to the line (first-order well posed)
          const iq = P(shared);
          ev = (x) => {
            const u = d.vsub(at(x, ib), at(x, ia));
            return [d.div(d.dot(d.vsub(at(x, ic), at(x, iq)), u), d.norm(u))];
          };
          break;
        }
        const sg = sign(sd0(g(s.c.c), s.l));
        ev = (x) => [d.sub(d.sc(sd(at(x, ic), at(x, ia), at(x, ib)), sg), x[r]!)];
        break;
      }
      case "tanCC": {
        const c1 = P(s.c1.c), c2 = P(s.c2.c), r1 = V(s.c1.ir), r2 = V(s.c2.ir);
        const ends = (c: Round) => (c.kind === "arc" ? [c.s, c.e] : []);
        const shared = ends(s.c1).find((q) => ends(s.c2).some((o) => same(q, o)));
        if (shared) {
          // both centres on one line through the shared end
          const iq = P(shared);
          ev = (x) => {
            const q = at(x, iq), u = d.vsub(at(x, c1), q);
            return [d.div(d.cross(u, d.vsub(at(x, c2), q)), d.norm(u))];
          };
          break;
        }
        const D0 = vlen(vsub(g(s.c1.c), g(s.c2.c))), R1 = x0[s.c1.ir]!, R2 = x0[s.c2.ir]!;
        const external = Math.abs(D0 - (R1 + R2)) <= Math.abs(D0 - Math.abs(R1 - R2));
        const sg = sign(R1 - R2);
        ev = (x) => [d.sub(d.dist(at(x, c1), at(x, c2)), external ? d.add(x[r1]!, x[r2]!) : d.sc(d.sub(x[r1]!, x[r2]!), sg))];
        break;
      }
      case "onCircle": {
        const ip = P(s.p), ic = P(s.c.c), r = V(s.c.ir);
        ev = (x) => [d.sub(d.dist(at(x, ip), at(x, ic)), x[r]!)];
        break;
      }
      case "midpoint": {
        const ip = P(s.p), ia = P(s.l.a), ib = P(s.l.b);
        ev = (x) => ([0, 1] as const).map((k) => d.sub(d.sc(x[ip[k]!]!, 2), d.add(x[ia[k]!]!, x[ib[k]!]!)));
        break;
      }
      case "symLine": {
        const ip = P(s.p), iq = P(s.q), ia = P(s.l.a), ib = P(s.l.b);
        ev = (x) => {
          const pp = at(x, ip), qq = at(x, iq), A = at(x, ia), B = at(x, ib);
          const mid: d.P = [d.sc(d.add(pp[0], qq[0]), 0.5), d.sc(d.add(pp[1], qq[1]), 0.5)];
          const u = d.vsub(B, A);
          return [sd(mid, A, B), d.div(d.dot(d.vsub(qq, pp), u), d.norm(u))];
        };
        break;
      }
      case "symPt": {
        const ip = P(s.p), iq = P(s.q), im = P(s.m);
        ev = (x) => ([0, 1] as const).map((k) => d.sub(d.add(x[ip[k]!]!, x[iq[k]!]!), d.sc(x[im[k]!]!, 2)));
        break;
      }
      case "symAxis": {
        const ip = P(s.p), iq = P(s.q), im = s.m ? P(s.m) : null, k = s.axis, o = (1 - k) as 0 | 1;
        ev = (x) => [
          im ? d.sub(d.add(x[ip[k]]!, x[iq[k]]!), d.sc(x[im[k]]!, 2)) : d.add(x[ip[k]]!, x[iq[k]]!),
          d.sub(x[ip[o]]!, x[iq[o]]!),
        ];
        break;
      }
    }
    return { label: s.label, vars, eval: ev, ...(s.structural ? { structural: true } : {}), data: s };
  });
}

// ---------------------------------------------------------------------------------------------
// Solve + diagnostics

export interface SolveHooks {
  warn(h: Host, message: string): void;
}

function where(loc: SourceLoc | undefined): string {
  if (!loc) return "";
  const f = loc.file.split(/[\\/]/).pop();
  return ` (${f}:${loc.line})`;
}

function snapVal(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v)) ? r + 0 : v;
}

interface Solved {
  m: Model;
  x: Float64Array;
  info: SolvedSketch;
  rest: Host[];
}

function solve(sketch: Host, hooks: SolveHooks): Solved {
  const { m, rest } = parse(sketch, hooks);
  layout(m);
  const x0 = Float64Array.from(m.x);
  const pts = m.points.map((p) => [x0[p.ix]!, x0[p.ix + 1]!] as Vec2);
  const ext = pts.length ? Math.hypot(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))) : 0;
  const S = Math.max(1, ext, ...m.specs.map((s) => ("v" in s && s.k !== "ang" && s.k !== "angle" && s.k !== "angAbs" && s.k !== "sweep" ? s.v : 0)));
  const constraints = equations(m, x0, S);
  const sys: System = { x0, constraints, scale: S };
  const order = [...constraints.keys()].sort((a, b) => Number(!constraints[a]!.structural) - Number(!constraints[b]!.structural));
  const r = lm(sys, order);
  if (!r.converged) {
    const c = findConflict(sys, order);
    const spec = (i: number) => constraints[i]!.data as Spec;
    if (c) {
      const culprit = spec(c.culprit);
      const partners = c.partners.filter((i) => !constraints[i]!.structural).map(spec);
      const list = partners.map((p) => `${p.label}${where(p.host.loc)}`);
      throw new TscadError(
        list.length
          ? `over-constrained: ${culprit.label} conflicts with ${list.join(", ")}`
          : `over-constrained: ${culprit.label} can't be satisfied (off by ${c.residual.toPrecision(3)} mm)`,
        {
          ...((culprit.host.loc ?? sketch.loc) ? { loc: culprit.host.loc ?? sketch.loc! } : {}),
          hint: list.length
            ? "remove one of these constraints or change a value so they agree (if the values are right, the drawn guess may be on the wrong side — move points closer to the intended shape)"
            : "check the values (impossible geometry?) or start the points closer to the intended shape",
        },
      );
    }
    throw new TscadError(`the sketch couldn't be solved (residual ${r.residual.toPrecision(3)} mm)`, { ...(sketch.loc ? { loc: sketch.loc } : {}), hint: "start the points closer to the intended shape" });
  }
  const x = r.x;
  const an = analyze(sys, x, order);
  for (const red of an.redundant) {
    const s = constraints[red.constraint]!.data as Spec;
    if (s.structural) continue;
    const by = red.partners.map((i) => constraints[i]!.data as Spec).filter((p) => !p.structural);
    hooks.warn(s.host, `redundant constraint: ${s.label} is already implied by ${by.length ? by.map((p) => `${p.label}${where(p.host.loc)}`).join(", ") : "the others"}`);
  }
  const FREE = 1e-6;
  const free: string[] = [];
  const freePts = new Set<Pt>();
  for (const p of m.points) if (an.freedom[p.ix]! > FREE || an.freedom[p.ix + 1]! > FREE) freePts.add(p);
  // report named points first; anonymous ones (centres, [x,y]) by their curve
  for (const p of freePts) free.push(pname(p));
  for (const c of m.curves) if ((c.kind === "arc" || c.kind === "circle") && an.freedom[c.ir]! > FREE && !(c.kind === "arc" && (freePts.has(c.s) || freePts.has(c.e)))) free.push(`${c.name} radius`);
  const status: SolvedSketch["status"] = an.dof > 0 ? "under" : "ok";
  if (an.dof > 0 && sketch.props.strict) {
    throw new TscadError(`under-constrained: ${an.dof} degree${an.dof === 1 ? "" : "s"} of freedom remain (free: ${free.join(", ")})`, {
      ...(sketch.loc ? { loc: sketch.loc } : {}),
      hint: "add dimensions or constraints, or fix a point (<point ... fixed />)",
    });
  }
  if (an.dof > 0 && !sketch.props.allowFree) hooks.warn(sketch, `under-constrained: ${an.dof} degree${an.dof === 1 ? "" : "s"} of freedom remain (free: ${free.slice(0, 6).join(", ")}${free.length > 6 ? `, +${free.length - 6} more` : ""}); solved near the drawn positions`);

  for (let i = 0; i < x.length; i++) x[i] = snapVal(x[i]!);
  const info: SolvedSketch = {
    ...(sketch.loc ? { loc: sketch.loc } : {}),
    status,
    dof: an.dof,
    free,
    residual: r.residual,
    iterations: r.iterations,
    points: m.points.map((p) => ({ id: p.name, x: x[p.ix]!, y: x[p.ix + 1]!, free: freePts.has(p) })),
    entities: m.curves.map((c) => entityInfo(c, x)),
    dimensions: m.specs.flatMap((s) => (s.dim ? [dimInfo(s, x)] : [])),
  };
  return { m, x, info, rest };
}

const ptOf = (x: Float64Array, p: Pt): Vec2 => [x[p.ix]!, x[p.ix + 1]!];

function entityInfo(c: Curve, x: Float64Array): SketchEntityInfo {
  const id = c.id ? { id: c.id } : {};
  switch (c.kind) {
    case "line":
      return { kind: "line", ...id, from: ptOf(x, c.a), to: ptOf(x, c.b), fromId: c.a.name, toId: c.b.name, construction: c.construction };
    case "arc":
      return { kind: "arc", ...id, center: ptOf(x, c.c), from: ptOf(x, c.s), to: ptOf(x, c.e), radius: x[c.ir]!, ccw: c.ccw, construction: c.construction };
    case "circle":
      return { kind: "circle", ...id, center: ptOf(x, c.c), radius: x[c.ir]!, construction: c.construction };
    case "spline":
      return { kind: "spline", ...id, points: c.pts.map((p) => ptOf(x, p)), degree: c.degree, construction: c.construction };
  }
}

function foot(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const u = vsub(b, a), t = vdot(vsub(p, a), u) / Math.max(vdot(u, u), 1e-300);
  return vadd(a, vsc(u, t));
}

function dimInfo(s: Spec, x: Float64Array): SketchDimensionInfo {
  const dim = s.dim!;
  const P = (p: Pt) => ptOf(x, p);
  let points: Vec2[] = [];
  switch (s.k) {
    case "dist":
    case "dxy":
      points = [P(s.p), P(s.q)];
      break;
    case "ptLine":
      points = [P(s.p), foot(P(s.p), P(s.l.a), P(s.l.b))];
      break;
    case "lineLine": {
      const mid = vsc(vadd(P(s.l1.a), P(s.l1.b)), 0.5);
      points = [mid, foot(mid, P(s.l2.a), P(s.l2.b))];
      break;
    }
    case "radius": {
      const c = P(s.c.c), r = x[s.c.ir]!;
      let t = Math.PI / 4;
      if (s.c.kind === "arc") {
        const a0 = Math.atan2(...(vsub(P(s.c.s), c).reverse() as [number, number]));
        let a1 = Math.atan2(...(vsub(P(s.c.e), c).reverse() as [number, number]));
        if (s.c.ccw) while (a1 <= a0) a1 += TAU;
        else while (a1 >= a0) a1 -= TAU;
        t = (a0 + a1) / 2;
      }
      points = [c, [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]];
      break;
    }
    case "angAbs": {
      const a = P(s.l.a), b = P(s.l.b);
      points = [a, [a[0] + vlen(vsub(b, a)), a[1]], b];
      break;
    }
    case "ang":
    case "angle": {
      const a1 = P(s.l1.a), b1 = P(s.l1.b), a2 = P(s.l2.a), b2 = P(s.l2.b);
      const u = vsub(b1, a1), w = vsub(b2, a2), den = u[0] * w[1] - u[1] * w[0];
      let v: Vec2;
      if (Math.abs(den) < 1e-12 * vlen(u) * vlen(w)) v = vsc(vadd(a1, a2), 0.5);
      else {
        const t = ((a2[0] - a1[0]) * w[1] - (a2[1] - a1[1]) * w[0]) / den;
        v = vadd(a1, vsc(u, t));
      }
      const far = (a: Vec2, b: Vec2) => (vlen(vsub(a, v)) > vlen(vsub(b, v)) ? a : b);
      points = [v, far(a1, b1), far(a2, b2)];
      break;
    }
    case "sweep":
      points = [P(s.a.c), P(s.a.s), P(s.a.e)];
      break;
  }
  const text = dim.kind === "radius" ? `R${fmt(dim.value)}` : dim.kind === "diameter" ? `⌀${fmt(dim.value)}` : dim.kind === "angle" || dim.kind === "sweep" ? `${fmt(dim.value)}°` : fmt(dim.value);
  return { kind: dim.kind, value: dim.value, text, points, ...(s.host.loc ? { loc: s.host.loc } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Profile: curves → closed loops

/**
 * The non-construction curves as segments: `"loops"` → closed loops (a profile); `"path"` →
 * one chain, open or closed, starting at the free end of the earliest-declared curve (a sweep
 * path), returned as a single-element list.
 */
function profile(sol: Solved, mode: "loops" | "path" = "loops"): Loop2[] {
  const { m, x } = sol;
  const tol = 1e-7 * Math.max(1, ...sol.info.points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const nodes: Vec2[] = [];
  const nodeOf = new Map<Pt, number>();
  const node = (p: Pt): number => {
    let n = nodeOf.get(p);
    if (n !== undefined) return n;
    const v = ptOf(x, p);
    n = nodes.findIndex((q) => Math.hypot(q[0] - v[0], q[1] - v[1]) <= tol);
    if (n < 0) {
      nodes.push(v);
      n = nodes.length - 1;
    }
    nodeOf.set(p, n);
    return n;
  };
  const loops: Loop2[] = [];
  interface Edge {
    c: Curve;
    s: number;
    e: number;
    seg: Seg2;
  }
  const edges: Edge[] = [];
  for (const c of m.curves) {
    if (c.construction) continue;
    if (c.kind === "circle") {
      const r = x[c.ir]!;
      if (!(r > 0)) m.fail(c.host, `${c.name} solved to radius ${r.toPrecision(3)}`);
      loops.push([arcSeg(ptOf(x, c.c), r, 0, TAU)]);
      continue;
    }
    if (c.kind === "line") {
      const s = node(c.a), e = node(c.b);
      if (s === e) m.fail(c.host, `${c.name} solved to zero length`);
      edges.push({ c, s, e, seg: lineSeg(nodes[s]!, nodes[e]!) });
    } else if (c.kind === "arc") {
      const s = node(c.s), e = node(c.e);
      const C = ptOf(x, c.c), r = x[c.ir]!;
      if (!(r > 0)) m.fail(c.host, `${c.name} solved to radius ${r.toPrecision(3)}`);
      const S = nodes[s]!, E = nodes[e]!;
      const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]);
      let a1 = Math.atan2(E[1] - C[1], E[0] - C[0]);
      if (s === e) a1 = a0 + (c.ccw ? TAU : -TAU);
      else if (c.ccw) while (a1 <= a0) a1 += TAU;
      else while (a1 >= a0) a1 -= TAU;
      const seg = arcSeg(C, r, a0, a1);
      if (s === e) loops.push([seg]);
      else edges.push({ c, s, e, seg });
    } else {
      const s = node(c.pts[0]!), e = node(c.pts[c.pts.length - 1]!);
      const pts = c.pts.map((p, i) => (i === 0 ? nodes[s]! : i === c.pts.length - 1 ? nodes[e]! : ptOf(x, p)));
      const n = pts.length, p = c.degree;
      const inner = n - p - 1;
      const knots = [...Array(p + 1).fill(0), ...Array.from({ length: inner }, (_, i) => (i + 1) / (inner + 1)), ...Array(p + 1).fill(1)];
      const seg: Seg2 = { kind: "nurbs", degree: p, pts: pts.map(([a, b]) => [a, b, 1]), knots };
      if (s === e) loops.push([seg]);
      else edges.push({ c, s, e, seg });
    }
  }
  const at = new Map<number, number[]>();
  edges.forEach((ed, i) => {
    for (const n of [ed.s, ed.e]) at.set(n, [...(at.get(n) ?? []), i]);
  });
  const nodeName = (n: number) => {
    const p = [...nodeOf].find(([, v]) => v === n)?.[0];
    return p ? `"${p.name}"` : `(${fmt(nodes[n]![0])}, ${fmt(nodes[n]![1])})`;
  };
  if (mode === "path") return [pathChain(m, edges, at, loops, nodeName)];
  for (const [n, list] of at) {
    if (list.length === 1) {
      const c = edges[list[0]!]!.c;
      m.fail(c.host, `open profile: ${c.name} ends at point ${nodeName(n)} and nothing continues from there`, "close the loop (end the last curve on the first one's start), or mark the curve construction");
    }
    if (list.length > 2) {
      const c = edges[list[2]!]!.c;
      m.fail(c.host, `branching profile: ${list.length} curves meet at point ${nodeName(n)} (${list.map((i) => edges[i]!.c.name).join(", ")})`, "a profile loop is a simple chain: mark the extra curves construction");
    }
  }
  const used = new Set<number>();
  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    const loop: Seg2[] = [];
    const first = edges[i]!;
    used.add(i);
    loop.push(first.seg);
    let cur = first.e;
    while (cur !== first.s) {
      const next = at.get(cur)!.find((j) => !used.has(j));
      if (next === undefined) break;
      used.add(next);
      const ed = edges[next]!;
      if (ed.s === cur) {
        loop.push(ed.seg);
        cur = ed.e;
      } else {
        loop.push(reverseSeg(ed.seg));
        cur = ed.s;
      }
    }
    loops.push(loop);
  }
  if (!loops.length) m.fail(sol.m.sketch, "the sketch has no profile: every curve is construction", "leave at least one closed loop of non-construction curves");
  return loops;
}

/** One chain through every edge (a sweep path). */
function pathChain(m: Model, edges: { c: Curve; s: number; e: number; seg: Seg2 }[], at: Map<number, number[]>, closed: Loop2[], nodeName: (n: number) => string): Seg2[] {
  if (closed.length) {
    if (closed.length === 1 && !edges.length) return closed[0]!;
    m.fail(m.sketch, "a sweep path must be one chain of curves, but it has a separate closed curve", "mark the extra curves construction");
  }
  if (!edges.length) m.fail(m.sketch, "the sweep path has no curves: every curve is construction");
  for (const [n, list] of at)
    if (list.length > 2) {
      const c = edges[list[2]!]!.c;
      m.fail(c.host, `branching sweep path: ${list.length} curves meet at point ${nodeName(n)}`, "a path is a simple chain: mark the extra curves construction");
    }
  const ends = [...at].filter(([, l]) => l.length === 1).map(([n]) => n);
  if (ends.length !== 0 && ends.length !== 2) m.fail(m.sketch, `the sweep path falls apart into ${ends.length / 2} pieces`, "every curve must continue from the previous one's end");
  // start: the free end of the earliest curve that has one (else the first curve's start)
  let start = edges[0]!.s;
  if (ends.length) {
    const firstEnd = edges.findIndex((ed) => ends.includes(ed.s) || ends.includes(ed.e));
    const ed = edges[firstEnd]!;
    start = ends.includes(ed.s) ? ed.s : ed.e;
  }
  const used = new Set<number>();
  const chain: Seg2[] = [];
  let cur = start;
  for (;;) {
    const next = (at.get(cur) ?? []).find((j) => !used.has(j));
    if (next === undefined) break;
    used.add(next);
    const ed = edges[next]!;
    if (ed.s === cur) {
      chain.push(ed.seg);
      cur = ed.e;
    } else {
      chain.push(reverseSeg(ed.seg));
      cur = ed.s;
    }
  }
  if (used.size !== edges.length) m.fail(m.sketch, "the sweep path falls apart into several pieces", "every curve must continue from the previous one's end");
  return chain;
}

// ---------------------------------------------------------------------------------------------
// Compiler integration

/** Solve a constraint `<sketch>` host: its closed loops (sketch coords) and the unsolved children. */
export function solveSketch(sketch: Host, outer: SolveHooks, mode: "loops" | "path" = "loops"): { loops: Loop2[]; rest: Host[]; info: SolvedSketch } {
  const k0 = cacheKey(sketch);
  const key = k0 === undefined ? undefined : `${mode}\n${k0}`;
  const cached = key !== undefined ? cache.get(key) : undefined;
  const rest = sketch.children.filter((c) => !isSolvedTag(c.tag));
  if (cached) {
    cache.delete(key!);
    cache.set(key!, cached); // LRU: most recent last
    for (const w of cached.warnings) outer.warn({ tag: w.tag, props: {}, children: [], key: null, ...(w.loc ? { loc: w.loc } : {}) }, w.msg);
    return { loops: cached.loops, rest, info: cached.info };
  }
  const warnings: CachedWarning[] = [];
  // messages show handles by name (`{base}`), not by their internal keys
  const hooks: SolveHooks = {
    warn: (h, msg) => {
      warnings.push({ tag: h.tag, ...(h.loc ? { loc: h.loc } : {}), msg: display(msg) });
      outer.warn(h, display(msg));
    },
  };
  const r = solveUncached(sketch, hooks, mode);
  if (key !== undefined) {
    cache.set(key, { loops: r.loops, info: r.info, warnings });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return { ...r, rest };
}

function isSolvedTag(tag: string): boolean {
  return CONSTRAINT_TAGS.has(tag) || tag === "circle";
}

interface CachedWarning {
  tag: string;
  loc?: SourceLoc;
  msg: string;
}
const CACHE_SIZE = 128;
/** Solved sketches by structure + values + source locations: param changes elsewhere skip the solve. */
const cache = new Map<string, { loops: Loop2[]; info: SolvedSketch; warnings: CachedWarning[] }>();

/** Forget cached sketch solves (tests, memory). */
export function clearSketchCache(): void {
  cache.clear();
}

/**
 * A canonical text of everything the solve depends on, or undefined when a prop can't be
 * serialised. Handle keys are renumbered by first appearance, so a fresh `sketchRefs()` per
 * render still hits.
 */
function cacheKey(sketch: Host): string | undefined {
  const renum = new Map<string, number>();
  let ok = true;
  const ser = (v: unknown): string => {
    if (v === null || v === undefined) return "_";
    if (typeof v === "number") return Object.is(v, -0) ? "0" : String(v);
    if (typeof v === "boolean") return v ? "T" : "F";
    if (typeof v === "string") return JSON.stringify(v);
    if (isSketchRef(v)) {
      const base = v.key.split(".")[0]!, sub = v.key.slice(base.length);
      if (!renum.has(base)) renum.set(base, renum.size);
      return `@${display(base)}#${renum.get(base)}${sub}`;
    }
    if (Array.isArray(v)) return `[${v.map(ser).join(",")}]`;
    ok = false;
    return "?";
  };
  const loc = (l?: SourceLoc) => (l ? `${l.file}:${l.line}:${l.column}` : "");
  const props = (p: Record<string, any>) =>
    Object.keys(p)
      .sort()
      .map((k) => `${k}=${ser(p[k])}`)
      .join(" ");
  const parts = [`sketch ${loc(sketch.loc)} ${props({ strict: sketch.props.strict, allowFree: sketch.props.allowFree })}`];
  for (const c of sketch.children) if (isSolvedTag(c.tag)) parts.push(`${c.tag} ${loc(c.loc)} ${props(c.props)}`);
  return ok ? parts.join("\n") : undefined;
}

function solveUncached(sketch: Host, hooks: SolveHooks, mode: "loops" | "path"): { loops: Loop2[]; info: SolvedSketch } {
  let sol: Solved, loops: Loop2[];
  try {
    sol = solve(sketch, hooks);
    loops = profile(sol, mode);
  } catch (e) {
    if (e instanceof TscadError && (e.detail.includes(REF_MARK) || e.hint?.includes(REF_MARK))) {
      throw new TscadError(display(e.detail), { ...(e.loc ? { loc: e.loc } : {}), ...(e.hint ? { hint: display(e.hint) } : {}) });
    }
    throw e;
  }
  sol.info.points.forEach((p) => (p.id = display(p.id)));
  sol.info.free = sol.info.free.map(display);
  for (const e of sol.info.entities) if (e.id) e.id = display(e.id);
  for (const e of sol.info.entities) if (e.kind === "line") (e.fromId = display(e.fromId)), (e.toId = display(e.toId));
  const hit = mode === "loops" ? crossing(loops) : undefined;
  if (hit) {
    hooks.warn(sketch, `the profile crosses itself near (${fmt(Number(hit[0].toFixed(4)))}, ${fmt(Number(hit[1].toFixed(4)))}): a constraint probably solved to its other branch (an unsigned length or distance flipped)`);
  }
  return { loops, info: sol.info };
}

/** A point where two loop edges properly cross (each loop as a polyline), if any. */
function crossing(loops: Loop2[]): Vec2 | undefined {
  const segs: [Vec2, Vec2, number, number][] = [];
  loops.forEach((l, li) => {
    const p = polyline(l);
    p.forEach((a, i) => segs.push([a, p[(i + 1) % p.length]!, li, i]));
  });
  if (segs.length > 4000) return undefined;
  const counts = loops.map((l) => polyline(l).length);
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b, la, ia] = segs[i]!, [c, dd, lb, ib] = segs[j]!;
      if (la === lb) {
        const n = counts[la]!;
        if (Math.abs(ia - ib) <= 1 || Math.abs(ia - ib) === n - 1) continue; // neighbours share an end
      }
      const r = vsub(b, a), q = vsub(dd, c), den = r[0] * q[1] - r[1] * q[0];
      if (Math.abs(den) < 1e-12 * vlen(r) * vlen(q)) continue;
      const w = vsub(c, a);
      const t = (w[0] * q[1] - w[1] * q[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
      const e = 1e-9;
      if (t > e && t < 1 - e && u > e && u < 1 - e) return vadd(a, vsc(r, t));
    }
  return undefined;
}

interface Pending {
  info: SolvedSketch;
  affine: Affine2;
  /** The element consuming the sketch (extrude, revolve, loft...). */
  parent: Host;
  frame?: Frame;
}

/**
 * Collects solved sketches while compiling, binds each to the IR node built from it and its
 * sketch plane, and emits `CompileResult.sketches` during the final path walk.
 */
export class SketchRecorder {
  private pending: Pending[] = [];
  private readonly byNode = new Map<Node, Pending[]>();
  readonly sketches: SketchInfo[] = [];

  /**
   * Solve `sketch` (placed by `affine`, consumed by `parent`) → loops in the parent's sketch
   * coordinates, plus the children that aren't constraint-sketch elements.
   */
  solve(sketch: Host, affine: Affine2, parent: Host, hooks: SolveHooks): { loops: { loop: Loop2; host: Host }[]; rest: Host[] } {
    const { loops, rest, info } = solveSketch(sketch, hooks);
    this.pending.push({ info, affine, parent });
    return { loops: loops.map((l) => ({ loop: transformLoop(l, affine), host: sketch })), rest };
  }

  /**
   * Solve `sketch` as a sweep path (one chain, open or closed) placed by `affine` on `frame`
   * (its 3D plane), for `parent`.
   */
  solvePath(sketch: Host, affine: Affine2, parent: Host, frame: Frame, hooks: SolveHooks): Seg2[] {
    const { loops, info } = solveSketch(sketch, hooks, "path");
    this.pending.push({ info, affine, parent, frame });
    return transformLoop(loops[0]!, affine);
  }

  /**
   * Bind `parent`'s pending sketches: give unframed ones `frame`; with a node (or `null`:
   * nothing was built), bind them to it and stop tracking them.
   */
  claim(parent: Host, node: Node | null | undefined, frame?: Frame): void {
    const mine = this.pending.filter((p) => p.parent === parent);
    if (frame) for (const p of mine) p.frame ??= frame;
    if (node === undefined) return;
    if (node) this.byNode.set(node, [...(this.byNode.get(node) ?? []), ...mine]);
    this.pending = this.pending.filter((p) => p.parent !== parent);
  }

  /** During the document walk: record sketches bound to `node` at `path`, `acc` = model matrix. */
  visit(node: Node, path: string, acc: Mat4): void {
    const list = this.byNode.get(node);
    if (!list) return;
    for (const p of list) {
      const f = p.frame ?? { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
      const [a, b, c, dd, e, ff] = p.affine;
      // frame columns u, v, n, origin; then the 2D affine in sketch space
      const F: Mat4 = [f.u[0], f.v[0], f.n[0], f.origin[0], f.u[1], f.v[1], f.n[1], f.origin[1], f.u[2], f.v[2], f.n[2], f.origin[2], 0, 0, 0, 1];
      const A: Mat4 = [a, b, 0, e, c, dd, 0, ff, 0, 0, 1, 0, 0, 0, 0, 1];
      this.sketches.push({ ...p.info, path, plane: mul4(acc, mul4(F, A)).map((v) => (Math.abs(v) < 1e-15 ? 0 : v)) });
    }
  }
}

// ---------------------------------------------------------------------------------------------

function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined, bestD = Infinity;
  for (const c of candidates) {
    const dd = lev(word, c);
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return bestD <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined;
}
function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}
