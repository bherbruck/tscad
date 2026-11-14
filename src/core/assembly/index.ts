/**
 * Assembly mates: `<anchor>` frames on parts and `<mate>` joints between them, solved for each
 * part's rigid motion with the sketch solver (Levenberg–Marquardt, exact Jacobian via duals,
 * minimum-norm steps from the declared placements).
 *
 * Each moving part gets a translation t and a quaternion q (normalised by a residual) applied
 * on top of an initial guess built by walking the mates out from the grounded part.
 */
import type { Node, Part } from "../../ir";
import { formatLoc, TscadError, type SourceLoc } from "../errors";
import {
  axisVector, chain, identity, isIdentity, mul, reflection, rotationAxis, rotationXYZ, rotationZ, rotationX, scaling, tidy, translation,
  type Mat4, type Vec3,
} from "../math";
import type { Host } from "../render";
import * as d from "../sketch/solver/dual";
import { analyze, findConflict, lm, type Constraint, type System } from "../sketch/solver/solve";
import type { MateType } from "./props";
import { isAnchorRef } from "./refs";

export type { AnchorProps, AssemblyElements, Direction, GearProps, MateProps, MateType } from "./props";
export { anchorRef, assemblyRefs, isAnchorRef, type AnchorRef, type PartRef } from "./refs";

// ---------------------------------------------------------------------------------------------
// Public metadata

/** `CompileResult.assembly`: solved parts, mates and anchor frames, for the viewer. */
export interface AssemblyInfo {
  parts: {
    name: string;
    /** Row-major 4×4 rigid motion applied to the part (on top of its declared placement). */
    transform: number[];
    /** Degrees of freedom the part still has relative to the ground. */
    dof: number;
    grounded: boolean;
  }[];
  mates: {
    a: string;
    b: string;
    type: MateType;
    /** The mate's `id` (for gears). */
    id?: string;
    /** Driven values, when given. */
    angle?: number;
    offset?: number;
    flip: boolean;
    /** The joint's solved position: rotation of b about a's axis (degrees) and travel along it (mm). */
    value: { angle: number; offset: number };
    limits?: [number, number];
    /** Largest residual at the solution (mm). */
    residual: number;
    ok: boolean;
    loc?: SourceLoc;
  }[];
  anchors: {
    part: string;
    id: string;
    /** Row-major 4×4 in model space after solving: columns are the x, y, z axes and the origin. */
    frame: number[];
    loc?: SourceLoc;
  }[];
}

export const ASSEMBLY_TAGS: ReadonlySet<string> = new Set(["anchor", "mate", "gear"]);
const MATE_TYPES: MateType[] = ["fastened", "revolute", "slider", "cylindrical", "planar", "ball"];
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Frames

type V3 = [number, number, number];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a: V3) => Math.sqrt(dot3(a, a));
const unit3 = (a: V3): V3 => {
  const l = len3(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};

/** Columns: x, y, z axes and origin. */
function frameMat(o: V3, x: V3, y: V3, z: V3): Mat4 {
  return [x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2], 0, 0, 0, 1];
}
const col = (m: Mat4, j: number): V3 => [m[j]!, m[4 + j]!, m[8 + j]!];
/** Re-orthonormalise a transformed frame (scale or shear in the placement). */
function orthoFrame(m: Mat4): Mat4 {
  const z = unit3(col(m, 2));
  const xr = col(m, 0);
  const x = unit3(sub3(xr, [z[0] * dot3(xr, z), z[1] * dot3(xr, z), z[2] * dot3(xr, z)]));
  return frameMat(col(m, 3), x, cross3(z, x), z);
}
function invRigid(m: Mat4): Mat4 {
  const r = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j * 4 + i]!));
  const t = col(m, 3);
  const ti = r.map((row) => -(row[0]! * t[0] + row[1]! * t[1] + row[2]! * t[2]));
  return [r[0]![0]!, r[0]![1]!, r[0]![2]!, ti[0]!, r[1]![0]!, r[1]![1]!, r[1]![2]!, ti[1]!, r[2]![0]!, r[2]![1]!, r[2]![2]!, ti[2]!, 0, 0, 0, 1];
}

// ---------------------------------------------------------------------------------------------
// Recorder (fed by the compiler)

export interface AssemblyHooks {
  /** The element's placement matrix (x/y/z/at/rotate/scale/mirror props). */
  placement(h: Host): Mat4;
  warn(h: Host, message: string): void;
  /** Record a new node's source location (the compiler's `emit`). */
  emit?(node: Node, h: Host): Node;
}

interface Anchor {
  partHost: Host;
  id: string;
  /** Model space, as declared. */
  frame: Mat4;
  host: Host;
}

/** Tags whose children are 2D (no anchors inside). */
const SKETCH_CONSUMERS = new Set(["extrude", "revolve", "loft", "sweep"]);

/** One `<assembly>` level: its own parts, nested assemblies and mates. */
interface Scope {
  host: Host | null;
  parent: Scope | null;
  parts: Host[];
  children: Scope[];
  mates: Host[];
  gears: Host[];
}

export class AssemblyRecorder {
  private readonly anchors: Anchor[] = [];
  private readonly root: Scope = { host: null, parent: null, parts: [], children: [], mates: [], gears: [] };
  private cur: Scope = this.root;
  private nMates = 0;
  info?: AssemblyInfo;

  constructor(private readonly hooks: AssemblyHooks) {}

  /** Entering `<assembly>` `h` (mates inside it are solved in its own scope). */
  enter(h: Host): void {
    const s: Scope = { host: h, parent: this.cur, parts: [], children: [], mates: [], gears: [] };
    this.cur.children.push(s);
    this.cur = s;
  }
  exit(): void {
    this.cur = this.cur.parent ?? this.root;
  }

  /** Collect the anchors inside part (or loose solid) `h`, whose model matrix is `m`. */
  part(h: Host, m: Mat4, partHost: Host = h): void {
    if (partHost === h && h.tag === "part") this.cur.parts.push(h);
    const visit = (c: Host, acc: Mat4) => {
      if (c.tag === "anchor") {
        this.anchors.push({ partHost, id: this.anchorId(c), frame: orthoFrame(mul(acc, anchorLocal(c))), host: c });
        return;
      }
      if (SKETCH_CONSUMERS.has(c.tag) || c.tag === "part" || c.tag === "assembly" || c.tag === "mate" || c.tag === "gear") return;
      if (!c.children.length) return;
      const mm = mul(mul(acc, this.hooks.placement(c)), ownMatrix(c));
      for (const k of c.children) visit(k, mm);
    };
    if (h.tag === "anchor") visit(h, m);
    else for (const k of h.children) visit(k, m);
  }

  private readonly looseHosts = new Set<Host>();
  /** A loose solid (outside any part), model matrix `m`: its anchors go to the implicit part. */
  loose(h: Host, m: Mat4): void {
    this.looseHosts.add(h);
    if (SKETCH_CONSUMERS.has(h.tag)) return; // 2D inside: no anchors
    if (h.tag === "anchor") this.part(h, m, h);
    else this.part(h, mul(mul(m, this.hooks.placement(h)), ownMatrix(h)), h);
  }

  /** A `<mate>` or `<gear>` of assembly `assembly` (the current scope). */
  mate(h: Host, _assembly?: Host): void {
    if (h.tag === "gear") this.cur.gears.push(h);
    else this.cur.mates.push(h);
    this.nMates++;
  }

  private anchorId(h: Host): string {
    const id = h.props.id;
    if (typeof id !== "string" || id === "" || id.includes(".")) {
      throw new TscadError(`<anchor> needs an id: a name without dots (got ${JSON.stringify(id)})`, { ...(h.loc ? { loc: h.loc } : {}), hint: `<anchor id="shaft" at={[0, 0, 20]} axis="z" />` });
    }
    return id;
  }

  /** Solve every scope's mates (innermost first) and move the parts (mutates `part.node`). */
  solve(parts: { part: Part; host: Host }[]): AssemblyInfo | undefined {
    if (!this.anchors.length && !this.nMates) return undefined;
    const loosePart = parts.find((p) => this.looseHosts.has(p.host))?.host;
    if (loosePart) {
      for (const a of this.anchors) if (this.looseHosts.has(a.partHost)) a.partHost = loosePart;
      this.root.parts.push(loosePart);
    }
    const nameOf = new Map<Host, string>();
    for (const p of parts) nameOf.set(p.host, p.part.name ?? "");
    const anchorsOf = new Map<Host, Anchor[]>();
    for (const a of this.anchors) if (nameOf.has(a.partHost)) anchorsOf.set(a.partHost, [...(anchorsOf.get(a.partHost) ?? []), a]);
    for (const [host, list] of anchorsOf) {
      const seen = new Set<string>();
      for (const a of list) {
        if (seen.has(a.id)) fail(a.host, `duplicate anchor "${a.id}" in part "${nameOf.get(host)}"`, "anchor ids must be unique within a part");
        seen.add(a.id);
      }
    }
    const info: AssemblyInfo = { parts: [], mates: [], anchors: [] };
    const dofOf = new Map<Host, number>();
    const grounded = new Set<Host>();

    /** Solve a scope: each part's motion within it (parts of nested scopes included). */
    const run = (scope: Scope): Map<Host, Mat4> => {
      const X = new Map<Host, Mat4>();
      const units: Unit[] = [];
      for (const p of scope.parts) {
        if (!nameOf.has(p)) continue;
        X.set(p, identity());
        const anchors = new Map<string, UAnchor>();
        for (const a of anchorsOf.get(p) ?? []) anchors.set(a.id, { frame: a.frame, host: a.host });
        units.push({ host: p, name: nameOf.get(p)!, fixed: p.props.fixed === true, anchors, parts: [p] });
      }
      for (const c of scope.children) {
        const inner = run(c);
        const anchors = new Map<string, UAnchor>();
        for (const [p, m] of inner) {
          X.set(p, m);
          for (const a of anchorsOf.get(p) ?? []) anchors.set(`${nameOf.get(p)}.${a.id}`, { frame: mul(m, a.frame), host: a.host });
        }
        const name = typeof c.host!.props.name === "string" ? (c.host!.props.name as string) : "";
        if (inner.size) units.push({ host: c.host!, name, fixed: c.host!.props.fixed === true, anchors, parts: [...inner.keys()], group: true });
      }
      if (!scope.mates.length && !scope.gears.length) return X;
      const r = solveUnits(units, scope, this.hooks);
      for (const u of units) {
        const Y = r.motion.get(u)!;
        for (const p of u.parts) X.set(p, mul(Y, X.get(p)!));
        const dof = r.dof.get(u) ?? 0;
        for (const p of u.parts) dofOf.set(p, (dofOf.get(p) ?? 0) + dof);
        if (r.grounded.has(u) && !u.group) grounded.add(u.host);
      }
      info.mates.push(...r.mates);
      return X;
    };
    const X = run(this.root);

    for (const { part, host } of parts) {
      let M = X.get(host) ?? identity();
      M = tidy(M.map((v) => (Math.abs(v - Math.round(v)) < 1e-10 ? Math.round(v) + 0 : v)));
      X.set(host, M);
      info.parts.push({ name: part.name ?? "", transform: M, dof: dofOf.get(host) ?? 0, grounded: grounded.has(host) });
      for (const a of anchorsOf.get(host) ?? []) info.anchors.push({ part: part.name ?? "", id: a.id, frame: tidy(mul(M, a.frame)), ...(a.host.loc ? { loc: a.host.loc } : {}) });
      if (isIdentity(M, 1e-12)) continue;
      const node = part.node;
      if (node.type === "transform") (node as { matrix: number[] }).matrix = tidy(mul(M, node.matrix as Mat4));
      else {
        const wrapped = { type: "transform", matrix: M as any, children: [node] } as Node;
        part.node = this.hooks.emit ? this.hooks.emit(wrapped, host) : wrapped;
      }
    }
    this.info = info;
    return info;
  }
}

function fail(h: Host | undefined, message: string, hint?: string): never {
  throw new TscadError(message, { ...(h?.loc ? { loc: h.loc } : {}), ...(hint ? { hint } : {}) });
}

function num(h: Host, name: string): number | undefined {
  const v = h.props[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(h, `${name} must be a finite number (got ${JSON.stringify(v)})`);
  return v;
}
function vec(h: Host, name: string): Vec3 | undefined {
  const v = h.props[name];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) fail(h, `${name} must be [x, y, z] (got ${JSON.stringify(v)})`);
  return [v[0], v[1], v[2]];
}
function direction(h: Host, name: string): V3 | undefined {
  const v = h.props[name];
  if (v === undefined) return undefined;
  if (typeof v === "string") {
    const m = /^(-?)([xyz])$/.exec(v);
    if (!m) fail(h, `${name} must be "x", "y", "z", "-x", "-y", "-z" or [x, y, z] (got ${JSON.stringify(v)})`);
    const a = axisVector(m[2] as "x");
    return m[1] ? [-a[0], -a[1], -a[2]] : a;
  }
  const a = vec(h, name)!;
  if (len3(a) === 0) fail(h, `${name} must not be zero`);
  return unit3(a);
}

/** An anchor's frame in its own coordinates. */
function anchorLocal(h: Host): Mat4 {
  const at = vec(h, "at") ?? [0, 0, 0];
  const o: V3 = [at[0] + (num(h, "x") ?? 0), at[1] + (num(h, "y") ?? 0), at[2] + (num(h, "z") ?? 0)];
  const z = direction(h, "axis") ?? [0, 0, 1];
  let xr = direction(h, "xAxis") ?? (Math.abs(z[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]);
  if (len3(cross3(z, xr)) < 1e-9) {
    if (h.props.xAxis !== undefined) fail(h, "xAxis is parallel to axis");
    xr = [0, 1, 0];
  }
  const x = unit3(sub3(xr, [z[0] * dot3(xr, z), z[1] * dot3(xr, z), z[2] * dot3(xr, z)]));
  return frameMat(o, x, cross3(z, x), z);
}

/** The transform an explicit transform element applies to its children. */
function ownMatrix(h: Host): Mat4 {
  const p = h.props;
  const n = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
  const v3 = (k: string): Vec3 => (Array.isArray(p[k]) && p[k].length === 3 ? [p[k][0], p[k][1], p[k][2]] : [0, 0, 0]);
  const about = (m: Mat4): Mat4 => {
    if (!Array.isArray(p.origin)) return m;
    const o = v3("origin");
    return chain(translation(-o[0], -o[1], -o[2]), m, translation(o[0], o[1], o[2]));
  };
  switch (h.tag) {
    case "translate": {
      const b = v3("by");
      return translation(b[0] + n("x"), b[1] + n("y"), b[2] + n("z"));
    }
    case "rotate": {
      if (p.axis !== undefined || p.angle !== undefined) {
        const axis: Vec3 = typeof p.axis === "string" ? axisVector(p.axis as "x") : Array.isArray(p.axis) ? v3("axis") : [0, 0, 1];
        return about(rotationAxis(axis, n("angle")));
      }
      const b = v3("by");
      return about(rotationXYZ(b[0] + n("x"), b[1] + n("y"), b[2] + n("z")));
    }
    case "scale":
      return about(typeof p.by === "number" ? scaling(p.by) : Array.isArray(p.by) ? scaling(p.by[0], p.by[1], p.by[2]) : identity());
    case "transform": {
      const raw = p.matrix;
      const flat: number[] = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw.flat() : raw) : [];
      return flat.length === 16 ? flat : flat.length === 12 ? [...flat, 0, 0, 0, 1] : identity();
    }
    case "mirror": {
      if (p.keep) return identity();
      const a: Vec3 = typeof p.axis === "string" ? axisVector(p.axis as "x") : Array.isArray(p.axis) ? v3("axis") : [1, 0, 0];
      return about(reflection(a));
    }
  }
  return identity();
}

// ---------------------------------------------------------------------------------------------
// Solve

/** Something that moves rigidly in a scope: a part, or a solved nested assembly. */
interface Unit {
  host: Host;
  name: string;
  fixed: boolean;
  /** By id within the unit: `"shaft"` for a part, `"motor.shaft"` for a nested assembly. */
  anchors: Map<string, UAnchor>;
  parts: Host[];
  group?: boolean;
}
interface UAnchor {
  frame: Mat4;
  host: Host;
}

interface Mate {
  h: Host;
  label: string;
  ua: Unit;
  ub: Unit;
  fa: Mat4;
  fb: Mat4;
  aName: string;
  bName: string;
  type: MateType;
  offset?: number;
  angle?: number;
  flip: boolean;
  id?: string;
  limits?: [number, number];
}
interface Gear {
  h: Host;
  label: string;
  a: Mate;
  b: Mate;
  ratio: number;
  phase: number;
}

/** The rigid frame relation of a mate: b's frame relative to a's. */
function relation(m: Mate): Mat4 {
  return chain(m.flip ? rotationX(180) : identity(), rotationZ(m.angle ?? 0), translation(0, 0, m.offset ?? 0));
}

type DV = [d.D, d.D, d.D];
const dsub = (a: DV, b: DV): DV => [d.sub(a[0], b[0]), d.sub(a[1], b[1]), d.sub(a[2], b[2])];
const dadd = (a: DV, b: DV): DV => [d.add(a[0], b[0]), d.add(a[1], b[1]), d.add(a[2], b[2])];
const dsc = (a: DV, k: number): DV => [d.sc(a[0], k), d.sc(a[1], k), d.sc(a[2], k)];
const ddot = (a: DV, b: DV): d.D => d.add(d.add(d.mul(a[0], b[0]), d.mul(a[1], b[1])), d.mul(a[2], b[2]));

interface WorldFrame {
  o: DV;
  x: DV;
  y: DV;
  z: DV;
}

interface ScopeResult {
  motion: Map<Unit, Mat4>;
  dof: Map<Unit, number>;
  grounded: Set<Unit>;
  mates: AssemblyInfo["mates"];
}

interface CachedScope {
  motion: Mat4[];
  dof: number[];
  grounded: number[];
  mates: AssemblyInfo["mates"];
  warnings: { tag: string; loc?: SourceLoc; msg: string }[];
}
const CACHE_SIZE = 64;
const cache = new Map<string, CachedScope>();
/** Forget cached mate solves. */
export function clearAssemblyCache(): void {
  cache.clear();
}

function scopeKey(units: Unit[], scope: Scope): string | undefined {
  const loc = (l?: SourceLoc) => (l ? `${l.file}:${l.line}:${l.column}` : "");
  let ok = true;
  const ser = (v: unknown): string => {
    if (v === undefined || v === null) return "_";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "string") return JSON.stringify(v);
    if (isAnchorRef(v)) return `@${v.part}.${v.id}`;
    if (Array.isArray(v)) return `[${v.map(ser).join(",")}]`;
    ok = false;
    return "?";
  };
  const props = (p: Record<string, any>) => Object.keys(p).sort().map((k) => `${k}=${ser(p[k])}`).join(" ");
  // (not the <assembly>'s own location: warnings hang off units and mates, whose locations are in the key)
  const parts = [`scope ${props({ strict: scope.host?.props.strict, allowFree: scope.host?.props.allowFree })}`];
  for (const u of units) {
    parts.push(`unit ${JSON.stringify(u.name)} ${u.fixed} ${u.group ? "g" : "p"} ${loc(u.host.loc)}`);
    for (const [id, a] of u.anchors) parts.push(` ${id} ${a.frame.map((v) => v.toPrecision(15)).join(",")}`);
  }
  for (const h of [...scope.mates, ...scope.gears]) parts.push(`${h.tag} ${loc(h.loc)} ${props(h.props)}`);
  return ok ? parts.join("\n") : undefined;
}

function solveUnits(units: Unit[], scope: Scope, outer: AssemblyHooks): ScopeResult {
  const key = scopeKey(units, scope);
  const hit = key !== undefined ? cache.get(key) : undefined;
  if (hit) {
    cache.delete(key!);
    cache.set(key!, hit);
    for (const w of hit.warnings) outer.warn({ tag: w.tag, props: {}, children: [], key: null, ...(w.loc ? { loc: w.loc } : {}) }, w.msg);
    return {
      motion: new Map(units.map((u, i) => [u, hit.motion[i]!])),
      dof: new Map(units.map((u, i) => [u, hit.dof[i]!])),
      grounded: new Set(hit.grounded.map((i) => units[i]!)),
      mates: hit.mates,
    };
  }
  const warnings: CachedScope["warnings"] = [];
  const hooks: AssemblyHooks = {
    ...outer,
    warn: (h, msg) => {
      warnings.push({ tag: h.tag, ...(h.loc ? { loc: h.loc } : {}), msg });
      outer.warn(h, msg);
    },
  };
  const r = solveScope(units, scope, hooks);
  if (key !== undefined) {
    cache.set(key, {
      motion: units.map((u) => r.motion.get(u)!),
      dof: units.map((u) => r.dof.get(u) ?? 0),
      grounded: units.flatMap((u, i) => (r.grounded.has(u) ? [i] : [])),
      mates: r.mates,
      warnings,
    });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return r;
}

function solveScope(units: Unit[], scope: Scope, hooks: AssemblyHooks): ScopeResult {
  // anchor names visible in this scope
  const byName = new Map<string, [Unit, UAnchor]>();
  const ambiguous = new Set<string>();
  for (const u of units)
    for (const [id, a] of u.anchors) {
      if (u.name) byName.set(`${u.name}.${id}`, [u, a]);
      if (u.group) {
        // a nested assembly's anchors also go by their own "part.anchor" names
        if (byName.has(id) && byName.get(id)![0] !== u) ambiguous.add(id);
        else if (!byName.has(id)) byName.set(id, [u, a]);
      }
    }
  for (const n of ambiguous) byName.delete(n);
  const resolve = (h: Host, prop: "a" | "b"): [Unit, UAnchor, string] => {
    const v = h.props[prop];
    const full = isAnchorRef(v) ? `${v.part}.${v.id}` : v;
    if (typeof full !== "string" || !full) fail(h, `${prop} must be an anchor: "part.anchor" or a handle (got ${JSON.stringify(v)})`, `<mate a="base.hinge" b="lid.hinge" type="revolute" />`);
    const hit = byName.get(full);
    if (hit) return [hit[0], hit[1], full];
    if (ambiguous.has(full)) fail(h, `${prop}: "${full}" is ambiguous (several sub-assemblies have it)`, `prefix the sub-assembly's name: "<assembly name>.${full}"`);
    const names = [...byName.keys()];
    const guess = closest(full, names);
    const partName = full.includes(".") ? full.slice(0, full.lastIndexOf(".")) : full;
    const inPart = names.filter((k) => k.startsWith(partName + "."));
    fail(
      h,
      `${prop}: no anchor "${full}"${scope.host ? " in this assembly" : ""}`,
      guess ? `did you mean "${guess}"?` : inPart.length ? `"${partName}" has ${inPart.map((k) => `"${k}"`).join(", ")}` : units.some((u) => u.name === partName) ? `"${partName}" has no anchors: add <anchor id="..." /> inside it` : `nothing named "${partName}" here (${units.map((u) => `"${u.name || "(unnamed assembly)"}"`).join(", ")})`,
    );
  };
  const mateIds = new Map<string, Mate>();
  const mates: Mate[] = scope.mates.map((h) => {
    const [ua, A, aName] = resolve(h, "a");
    const [ub, B, bName] = resolve(h, "b");
    if (ua === ub) fail(h, `a and b are on the same ${ua.group ? "sub-assembly" : "part"} ("${ua.name}")`, "a mate joins two things that move separately");
    const type = (h.props.type ?? "fastened") as MateType;
    if (!MATE_TYPES.includes(type)) fail(h, `type must be one of ${MATE_TYPES.map((t) => `"${t}"`).join(", ")} (got ${JSON.stringify(h.props.type)})`, type === ("gear" as string) ? "gears are their own element: <gear a=\"mateId\" b=\"mateId\" ratio={2} />" : undefined);
    const offset = num(h, "offset") ?? num(h, "distance");
    const angle = num(h, "angle");
    if (type === "ball" && angle !== undefined) hooks.warn(h, "angle is ignored on a ball joint");
    let limits: [number, number] | undefined;
    if (h.props.limits !== undefined) {
      const l = h.props.limits as number[];
      if (!Array.isArray(l) || l.length !== 2 || !l.every((v) => typeof v === "number") || !(l[0]! <= l[1]!)) fail(h, `limits must be [min, max] (got ${JSON.stringify(l)})`);
      limits = [l[0]!, l[1]!];
    }
    const id = typeof h.props.id === "string" ? (h.props.id as string) : undefined;
    const label = `<mate a="${aName}" b="${bName}" type="${type}"${offset !== undefined ? ` offset=${offset}` : ""}${angle !== undefined ? ` angle=${angle}` : ""}>`;
    const m: Mate = { h, label, ua, ub, fa: A.frame, fb: B.frame, aName, bName, type, flip: h.props.flip === true, ...(offset !== undefined ? { offset } : {}), ...(angle !== undefined ? { angle } : {}), ...(id ? { id } : {}), ...(limits ? { limits } : {}) };
    if (id) {
      if (mateIds.has(id)) fail(h, `duplicate mate id "${id}"`);
      mateIds.set(id, m);
    }
    return m;
  });
  const gears: Gear[] = scope.gears.map((h) => {
    const get = (prop: "a" | "b"): Mate => {
      const v = h.props[prop];
      const m = typeof v === "string" ? mateIds.get(v) : undefined;
      if (!m) fail(h, `${prop} must name a revolute/cylindrical <mate id=...> in this assembly (got ${JSON.stringify(v)})`, closest(String(v), [...mateIds.keys()]) ? `did you mean "${closest(String(v), [...mateIds.keys()])}"?` : `give the joints ids: <mate id="motor" ... type="revolute" />`);
      if (m.type !== "revolute" && m.type !== "cylindrical") fail(h, `${prop}="${v}" is a ${m.type} mate; gears relate revolute or cylindrical joints`);
      return m;
    };
    const ratio = num(h, "ratio");
    if (ratio === undefined || ratio === 0) fail(h, "needs a non-zero ratio (b turns ratio × a's angle)", `<gear a="motor" b="wheel" ratio={-0.5} />`);
    const a = get("a"), b = get("b");
    const phase = num(h, "phase") ?? 0;
    return { h, label: `<gear a="${h.props.a}" b="${h.props.b}" ratio=${ratio}>`, a, b, ratio, phase };
  });

  // grounding: `fixed` units, else the first
  const grounded = new Set(units.filter((u) => u.fixed));
  if (!grounded.size && units.length) grounded.add(units[0]!);

  // initial guess: walk the mates out from the ground, placing each unit exactly on its mate
  const guess = new Map<Unit, Mat4>();
  for (const g of grounded) guess.set(g, identity());
  for (let progress = true; progress; ) {
    progress = false;
    for (const m of mates) {
      const ka = guess.has(m.ua), kb = guess.has(m.ub);
      if (ka === kb) continue;
      const rel = relation(m);
      if (ka) {
        const target = mul(mul(guess.get(m.ua)!, m.fa), rel);
        guess.set(m.ub, m.type === "ball" ? translation(...sub3(col(target, 3), col(m.fb, 3))) : mul(target, invRigid(m.fb)));
      } else {
        const target = mul(mul(guess.get(m.ub)!, m.fb), invRigid(rel));
        guess.set(m.ua, m.type === "ball" ? translation(...sub3(col(target, 3), col(m.fa, 3))) : mul(target, invRigid(m.fa)));
      }
      progress = true;
    }
  }
  for (const u of units) if (!guess.has(u)) guess.set(u, identity());

  // variables: t (3) + q (4) per moving unit that takes part in a mate
  const mated = new Set<Unit>(mates.flatMap((m) => [m.ua, m.ub]));
  const vix = new Map<Unit, number>();
  const x0: number[] = [];
  for (const u of units) {
    if (grounded.has(u) || !mated.has(u)) continue;
    vix.set(u, x0.length);
    x0.push(0, 0, 0, 1, 0, 0, 0);
  }
  const S = Math.max(1, ...mates.flatMap((m) => [len3(col(mul(guess.get(m.ua)!, m.fa), 3)), len3(col(mul(guess.get(m.ub)!, m.fb), 3)), Math.abs(m.offset ?? 0)]));

  const constraints: Constraint[] = [];
  for (const [u, i] of vix) {
    constraints.push({
      label: `"${u.name}" (rotation normalisation)`,
      vars: [i + 3, i + 4, i + 5, i + 6],
      structural: true,
      eval: ([w, a, b, c]) => [d.sc(d.addc(d.add(d.add(d.mul(w!, w!), d.mul(a!, a!)), d.add(d.mul(b!, b!), d.mul(c!, c!))), -1), S)],
    });
  }
  /** Local variable layout for a set of units: unit → offset into the constraint's vars. */
  const layout = (us: Unit[]) => {
    const vars: number[] = [];
    const at = new Map<Unit, number>();
    for (const u of us) {
      const i = vix.get(u);
      if (i === undefined || at.has(u)) continue;
      at.set(u, vars.length);
      vars.push(i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6);
    }
    return { vars, at: (u: Unit) => at.get(u) ?? -1 };
  };
  const frames = (m: Mate, x: d.D[], at: (u: Unit) => number) => {
    const n = x.length;
    return [world(x, at(m.ua), mul(guess.get(m.ua)!, m.fa), n), world(x, at(m.ub), mul(guess.get(m.ub)!, m.fb), n)] as const;
  };
  for (const m of mates) {
    const { vars, at } = layout([m.ua, m.ub]);
    const off = m.offset ?? 0, sgn = m.flip ? -1 : 1;
    const ang = (m.angle ?? 0) * DEG, ca = Math.cos(ang), sa = Math.sin(ang);
    const t = m.type;
    const wantOrigin = t === "fastened" || t === "revolute" || t === "ball";
    const wantAxis = t !== "ball";
    const wantX = t === "fastened" || t === "slider" || (m.angle !== undefined && (t === "revolute" || t === "cylindrical" || t === "planar"));
    const wantLine = t === "slider" || t === "cylindrical";
    const wantAlong = t === "planar" || ((t === "slider" || t === "cylindrical") && m.offset !== undefined);
    constraints.push({
      label: m.label,
      vars,
      data: m,
      eval: (x) => {
        const [A, B] = frames(m, x, at);
        const out: d.D[] = [];
        const rel = dsub(B.o, A.o);
        if (wantOrigin) out.push(...dsub(rel, dsc(A.z, off)));
        if (wantAxis) out.push(...dsc(dsub(B.z, dsc(A.z, sgn)), S));
        if (wantX) out.push(...dsc(dsub(B.x, dadd(dsc(A.x, ca), dsc(A.y, sa))), S));
        if (wantLine) out.push(ddot(rel, A.x), ddot(rel, A.y));
        if (wantAlong) out.push(d.addc(ddot(rel, A.z), -off));
        return out;
      },
    });
  }
  for (const g of gears) {
    const { vars, at } = layout([g.a.ua, g.a.ub, g.b.ua, g.b.ub]);
    const angleOf = (m: Mate, x: d.D[]) => {
      const [A, B] = frames(m, x, at);
      return d.atan2(ddot(B.x, A.y), ddot(B.x, A.x));
    };
    constraints.push({
      label: g.label,
      vars,
      data: g,
      eval: (x) => [d.sc(d.wrapPi(d.addc(d.sub(angleOf(g.b, x), d.sc(angleOf(g.a, x), g.ratio)), -g.phase * DEG)), S)],
    });
  }

  const sys: System = { x0: Float64Array.from(x0), constraints, scale: S };
  const order = [...constraints.keys()];
  const r = lm(sys, order, sys.x0, 400);
  const userOf = (i: number) => {
    const v = constraints[i]!.data as Mate | Gear | undefined;
    return v;
  };
  if (!r.converged) {
    const c = findConflict(sys, order);
    const culprit = c ? userOf(c.culprit) : undefined;
    if (c && culprit) {
      const partners = c.partners.map(userOf).filter((x): x is Mate | Gear => !!x);
      throw new TscadError(
        partners.length
          ? `over-constrained assembly: ${culprit.label} conflicts with ${partners.map((p) => `${p.label} (${shortLoc(p.h.loc)})`).join(", ")}`
          : `over-constrained assembly: ${culprit.label} can't be satisfied (off by ${c.residual.toPrecision(3)})`,
        { ...(culprit.h.loc ? { loc: culprit.h.loc } : {}), hint: "remove one of the mates, loosen a type (fastened → revolute...), or check the anchors' positions and axes" },
      );
    }
    throw new TscadError(`the assembly's mates couldn't be solved (residual ${r.residual.toPrecision(3)})`, scope.mates[0]?.loc ? { loc: scope.mates[0].loc } : {});
  }

  const an = analyze(sys, r.x, order);
  const strict = scope.host?.props.strict === true;
  if (strict)
    for (const red of an.redundant) {
      const m = userOf(red.constraint);
      const by = red.partners.map(userOf).filter((x): x is Mate | Gear => !!x);
      if (m && by.length) hooks.warn(m.h, `redundant mate: ${m.label} is already implied by ${by.map((p) => `${p.label} (${shortLoc(p.h.loc)})`).join(", ")}`);
    }
  const dof = new Map<Unit, number>();
  for (const [u, i] of vix) {
    const P = Array.from({ length: 7 }, (_, a) => Array.from({ length: 7 }, (_, b) => (a === b ? 1 : 0) - an.basis.reduce((s, q) => s + q[i + a]! * q[i + b]!, 0)));
    dof.set(u, psdRank(P));
  }
  const allowFree = scope.host?.props.allowFree === true;
  for (const [u, n] of dof) {
    const what = u.group ? `sub-assembly "${u.name || "(unnamed)"}"` : `part "${u.name}"`;
    if (n > 0 && strict) fail(u.host, `${what} is under-constrained: its mates leave ${n} degree${n === 1 ? "" : "s"} of freedom`, "drive joints with angle/offset, or use stricter mate types");
    if (n > 0 && !allowFree) hooks.warn(u.host, `${what} can still move: ${n} degree${n === 1 ? "" : "s"} of freedom left by its mates (it stays where it was placed; drive joints with angle/offset)`);
  }

  const motion = new Map<Unit, Mat4>();
  for (const u of units) {
    const i = vix.get(u);
    motion.set(u, i === undefined ? guess.get(u)! : mul(rigid(r.x, i), guess.get(u)!));
  }
  // joint values (for the viewer and limits)
  const mateInfo = mates.map((m) => {
    const ci = constraints.findIndex((c) => c.data === m);
    let res = 0;
    r.F.forEach((f, j) => {
      if (r.owner[j] === ci) res = Math.max(res, Math.abs(f));
    });
    const A = mul(motion.get(m.ua)!, m.fa), B = mul(motion.get(m.ub)!, m.fb);
    const value = {
      angle: Math.atan2(dot3(col(B, 0), col(A, 1)), dot3(col(B, 0), col(A, 0))) / DEG,
      offset: dot3(sub3(col(B, 3), col(A, 3)), col(A, 2)),
    };
    const cleaned = { angle: Math.abs(value.angle) < 1e-9 ? 0 : value.angle, offset: Math.abs(value.offset) < 1e-9 ? 0 : value.offset };
    if (m.limits) {
      const which = m.type === "slider" ? "offset" : "angle";
      const v = cleaned[which];
      const [lo, hi] = m.limits;
      const tol = 1e-9 * Math.max(1, Math.abs(v));
      if (v < lo - tol || v > hi + tol) hooks.warn(m.h, `${which} ${Number(v.toFixed(6))}${which === "angle" ? "°" : " mm"} is outside limits [${lo}, ${hi}]`);
    }
    return {
      a: m.aName,
      b: m.bName,
      type: m.type,
      ...(m.id ? { id: m.id } : {}),
      ...(m.angle !== undefined ? { angle: m.angle } : {}),
      ...(m.offset !== undefined ? { offset: m.offset } : {}),
      flip: m.flip,
      value: cleaned,
      ...(m.limits ? { limits: m.limits } : {}),
      residual: res,
      ok: true,
      ...(m.h.loc ? { loc: m.h.loc } : {}),
    };
  });
  return { motion, dof, grounded, mates: mateInfo };
}

/** The anchor frame in model space as duals (part variables at local offset `l`, or fixed). */
function world(x: d.D[], l: number, F: Mat4, n: number): WorldFrame {
  const K = (v: V3): DV => [d.konst(v[0], n), d.konst(v[1], n), d.konst(v[2], n)];
  if (l < 0) return { o: K(col(F, 3)), x: K(col(F, 0)), y: K(col(F, 1)), z: K(col(F, 2)) };
  const t: DV = [x[l]!, x[l + 1]!, x[l + 2]!];
  const w = x[l + 3]!, u: DV = [x[l + 4]!, x[l + 5]!, x[l + 6]!];
  const ww = d.sub(d.mul(w, w), ddot(u, u));
  // R v = (w² − u·u) v + 2 (u·v) u + 2 w (u × v)
  const rot = (v: V3): DV => {
    const uv = d.add(d.add(d.sc(u[0], v[0]), d.sc(u[1], v[1])), d.sc(u[2], v[2]));
    const uxv: DV = [d.sub(d.sc(u[1], v[2]), d.sc(u[2], v[1])), d.sub(d.sc(u[2], v[0]), d.sc(u[0], v[2])), d.sub(d.sc(u[0], v[1]), d.sc(u[1], v[0]))];
    return [0, 1, 2].map((k) => d.add(d.add(d.sc(ww, v[k]!), d.sc(d.mul(uv, u[k]!), 2)), d.sc(d.mul(w, uxv[k]!), 2))) as DV;
  };
  return { o: dadd(rot(col(F, 3)), t), x: rot(col(F, 0)), y: rot(col(F, 1)), z: rot(col(F, 2)) };
}

/** The solved rigid motion of a part's variables (quaternion normalised). */
function rigid(x: Float64Array, i: number): Mat4 {
  const [tx, ty, tz] = [x[i]!, x[i + 1]!, x[i + 2]!];
  let [w, a, b, c] = [x[i + 3]!, x[i + 4]!, x[i + 5]!, x[i + 6]!];
  const l = Math.hypot(w, a, b, c) || 1;
  [w, a, b, c] = [w / l, a / l, b / l, c / l];
  return [
    1 - 2 * (b * b + c * c), 2 * (a * b - w * c), 2 * (a * c + w * b), tx,
    2 * (a * b + w * c), 1 - 2 * (a * a + c * c), 2 * (b * c - w * a), ty,
    2 * (a * c - w * b), 2 * (b * c + w * a), 1 - 2 * (a * a + b * b), tz,
    0, 0, 0, 1,
  ];
}

/** Rank of a symmetric positive semi-definite matrix (pivoted Cholesky). */
function psdRank(P: number[][]): number {
  const n = P.length;
  const A = P.map((r) => [...r]);
  let rank = 0;
  const used = new Set<number>();
  for (let k = 0; k < n; k++) {
    let p = -1, best = 1e-6;
    for (let i = 0; i < n; i++) if (!used.has(i) && A[i]![i]! > best) (best = A[i]![i]!), (p = i);
    if (p < 0) break;
    used.add(p);
    rank++;
    const piv = A[p]![p]!;
    const rowp = [...A[p]!];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i]![j]! -= (rowp[i]! * rowp[j]!) / piv;
  }
  return rank;
}

function shortLoc(loc?: SourceLoc): string {
  if (!loc) return "?";
  return `${loc.file.split(/[\\/]/).pop()}:${loc.line}`;
}
void formatLoc;

function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined, bestD = Infinity;
  for (const c of candidates) {
    const dd = lev(word, c);
    if (dd < bestD) (bestD = dd), (best = c);
  }
  return bestD <= Math.max(2, Math.floor(word.length / 4)) ? best : undefined;
}
function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}
