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

export type { AnchorProps, AssemblyElements, Direction, MateProps, MateType } from "./props";
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
    /** Driven values, when given. */
    angle?: number;
    offset?: number;
    flip: boolean;
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

export const ASSEMBLY_TAGS: ReadonlySet<string> = new Set(["anchor", "mate"]);
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

export class AssemblyRecorder {
  private readonly anchors: Anchor[] = [];
  private readonly mates: { h: Host; assembly: Host }[] = [];
  info?: AssemblyInfo;

  constructor(private readonly hooks: AssemblyHooks) {}

  /** Collect the anchors inside part (or loose solid) `h`, whose model matrix is `m`. */
  part(h: Host, m: Mat4, partHost: Host = h): void {
    const visit = (c: Host, acc: Mat4) => {
      if (c.tag === "anchor") {
        this.anchors.push({ partHost, id: this.anchorId(c), frame: orthoFrame(mul(acc, anchorLocal(c))), host: c });
        return;
      }
      if (SKETCH_CONSUMERS.has(c.tag) || c.tag === "part" || c.tag === "assembly" || c.tag === "mate") return;
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
    if (h.tag === "anchor") this.part(h, m, h);
    else this.part(h, mul(mul(m, this.hooks.placement(h)), ownMatrix(h)), h);
  }

  mate(h: Host, assembly: Host): void {
    this.mates.push({ h, assembly });
  }

  private anchorId(h: Host): string {
    const id = h.props.id;
    if (typeof id !== "string" || id === "" || id.includes(".")) {
      throw new TscadError(`<anchor> needs an id: a name without dots (got ${JSON.stringify(id)})`, { ...(h.loc ? { loc: h.loc } : {}), hint: `<anchor id="shaft" at={[0, 0, 20]} axis="z" />` });
    }
    return id;
  }

  /** Solve the mates and move the parts (mutates `part.node`). */
  solve(parts: { part: Part; host: Host }[]): AssemblyInfo | undefined {
    if (!this.anchors.length && !this.mates.length) return undefined;
    // the implicit part of loose solids is listed under its first solid's host
    const loosePart = parts.find((p) => this.looseHosts.has(p.host))?.host;
    if (loosePart) for (const a of this.anchors) if (this.looseHosts.has(a.partHost)) a.partHost = loosePart;
    this.info = solveAssembly(parts, this.anchors, this.mates, this.hooks);
    return this.info;
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

interface Mate {
  h: Host;
  label: string;
  a: Anchor;
  b: Anchor;
  aName: string;
  bName: string;
  type: MateType;
  offset?: number;
  angle?: number;
  flip: boolean;
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

function solveAssembly(parts: { part: Part; host: Host }[], anchors: Anchor[], mateHosts: { h: Host; assembly: Host }[], hooks: AssemblyHooks): AssemblyInfo {
  const nameOf = new Map<Host, string>();
  parts.forEach((p) => nameOf.set(p.host, p.part.name ?? ""));
  const live = anchors.filter((a) => nameOf.has(a.partHost));
  const byName = new Map<string, Anchor>();
  for (const a of live) {
    const full = `${nameOf.get(a.partHost)}.${a.id}`;
    if (byName.has(full)) fail(a.host, `duplicate anchor "${a.id}" in part "${nameOf.get(a.partHost)}"`, "anchor ids must be unique within a part");
    byName.set(full, a);
  }
  const resolve = (h: Host, prop: "a" | "b"): [Anchor, string] => {
    const v = h.props[prop];
    const full = isAnchorRef(v) ? `${v.part}.${v.id}` : v;
    if (typeof full !== "string" || !full) fail(h, `${prop} must be an anchor: "part.anchor" or a handle (got ${JSON.stringify(v)})`, `<mate a="base.hinge" b="lid.hinge" type="revolute" />`);
    const a = byName.get(full);
    if (a) return [a, full];
    const guess = closest(full, [...byName.keys()]);
    const partName = full.includes(".") ? full.slice(0, full.lastIndexOf(".")) : full;
    const inPart = [...byName.keys()].filter((k) => k.startsWith(partName + "."));
    fail(
      h,
      `${prop}: no anchor "${full}"`,
      guess ? `did you mean "${guess}"?` : inPart.length ? `part "${partName}" has ${inPart.map((k) => `"${k}"`).join(", ")}` : parts.some((p) => p.part.name === partName) ? `part "${partName}" has no anchors: add <anchor id="..." /> inside it` : `no part named "${partName}" (parts: ${parts.map((p) => `"${p.part.name}"`).join(", ")})`,
    );
  };
  const mates: Mate[] = mateHosts.map(({ h }) => {
    const [a, aName] = resolve(h, "a");
    const [b, bName] = resolve(h, "b");
    if (a.partHost === b.partHost) fail(h, `a and b are on the same part ("${nameOf.get(a.partHost)}")`, "a mate joins two different parts");
    const type = (h.props.type ?? "fastened") as MateType;
    if (!MATE_TYPES.includes(type)) fail(h, `type must be one of ${MATE_TYPES.map((t) => `"${t}"`).join(", ")} (got ${JSON.stringify(h.props.type)})`);
    const offset = num(h, "offset") ?? num(h, "distance");
    const angle = num(h, "angle");
    if (type === "ball" && angle !== undefined) hooks.warn(h, "angle is ignored on a ball joint");
    if (type === "slider" && angle !== undefined) hooks.warn(h, "a slider keeps the orientation fixed; angle sets that fixed rotation");
    const label = `<mate a="${aName}" b="${bName}" type="${type}"${offset !== undefined ? ` offset=${offset}` : ""}${angle !== undefined ? ` angle=${angle}` : ""}>`;
    return { h, label, a, b, aName, bName, type, ...(offset !== undefined ? { offset } : {}), ...(angle !== undefined ? { angle } : {}), flip: h.props.flip === true };
  });

  // grounded parts: `fixed`, else the first part
  const hosts = parts.map((p) => p.host);
  const grounded = new Set(hosts.filter((h) => h.props.fixed === true));
  if (!grounded.size && hosts.length) grounded.add(hosts[0]!);

  // initial guess: walk the mates out from the ground, placing each part exactly on its mate
  const guess = new Map<Host, Mat4>();
  for (const g of grounded) guess.set(g, identity());
  for (let progress = true; progress; ) {
    progress = false;
    for (const m of mates) {
      const pa = m.a.partHost, pb = m.b.partHost;
      const ka = guess.has(pa), kb = guess.has(pb);
      if (ka === kb) continue;
      const rel = relation(m);
      if (ka) {
        const target = mul(mul(guess.get(pa)!, m.a.frame), rel);
        guess.set(pb, m.type === "ball" ? translation(...sub3(col(target, 3), col(m.b.frame, 3))) : mul(target, invRigid(m.b.frame)));
      } else {
        const target = mul(mul(guess.get(pb)!, m.b.frame), invRigid(rel));
        guess.set(pa, m.type === "ball" ? translation(...sub3(col(target, 3), col(m.a.frame, 3))) : mul(target, invRigid(m.a.frame)));
      }
      progress = true;
    }
  }
  for (const h of hosts) if (!guess.has(h)) guess.set(h, identity());

  // variables: t (3) + q (4) per moving part that takes part in a mate
  const mated = new Set<Host>(mates.flatMap((m) => [m.a.partHost, m.b.partHost]));
  const vix = new Map<Host, number>();
  const x0: number[] = [];
  for (const h of hosts) {
    if (grounded.has(h) || !mated.has(h)) continue;
    vix.set(h, x0.length);
    x0.push(0, 0, 0, 1, 0, 0, 0);
  }
  const S = Math.max(1, ...live.map((a) => len3(col(mul(guess.get(a.partHost)!, a.frame), 3))), ...mates.map((m) => Math.abs(m.offset ?? 0)));

  const constraints: Constraint[] = [];
  // quaternion normalisation (structural)
  for (const [h, i] of vix) {
    constraints.push({
      label: `part "${nameOf.get(h)}" (rotation normalisation)`,
      vars: [i + 3, i + 4, i + 5, i + 6],
      structural: true,
      eval: ([w, a, b, c]) => [d.sc(d.addc(d.add(d.add(d.mul(w!, w!), d.mul(a!, a!)), d.add(d.mul(b!, b!), d.mul(c!, c!))), -1), S)],
    });
  }
  for (const m of mates) {
    const vars: number[] = [];
    const ia = vix.get(m.a.partHost), ib = vix.get(m.b.partHost);
    const la = ia === undefined ? -1 : vars.push(...[0, 1, 2, 3, 4, 5, 6].map((k) => ia + k)) - 7;
    const lb = ib === undefined ? -1 : vars.push(...[0, 1, 2, 3, 4, 5, 6].map((k) => ib + k)) - 7;
    const Fa = mul(guess.get(m.a.partHost)!, m.a.frame), Fb = mul(guess.get(m.b.partHost)!, m.b.frame);
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
        const n = x.length;
        const A = world(x, la, Fa, n), B = world(x, lb, Fb, n);
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

  const sys: System = { x0: Float64Array.from(x0), constraints, scale: S };
  const order = [...constraints.keys()];
  const r = lm(sys, order, sys.x0, 400);
  const mateOf = (i: number) => constraints[i]!.data as Mate | undefined;
  if (!r.converged) {
    const c = findConflict(sys, order);
    const culprit = c ? mateOf(c.culprit) : undefined;
    if (c && culprit) {
      const partners = c.partners.map(mateOf).filter((x): x is Mate => !!x);
      throw new TscadError(
        partners.length
          ? `over-constrained assembly: ${culprit.label} conflicts with ${partners.map((p) => `${p.label} (${shortLoc(p.h.loc)})`).join(", ")}`
          : `over-constrained assembly: ${culprit.label} can't be satisfied (off by ${c.residual.toPrecision(3)})`,
        { ...(culprit.h.loc ? { loc: culprit.h.loc } : {}), hint: "remove one of the mates, loosen a type (fastened → revolute...), or check the anchors' positions and axes" },
      );
    }
    throw new TscadError(`the assembly's mates couldn't be solved (residual ${r.residual.toPrecision(3)})`, mateHosts[0]?.h.loc ? { loc: mateHosts[0].h.loc } : {});
  }

  const an = analyze(sys, r.x, order);
  // closing a planar loop is redundant in 3D yet perfectly normal: only `strict` reports it
  const strict = mateHosts.some((m) => m.assembly.props.strict);
  if (strict) for (const red of an.redundant) {
    const m = mateOf(red.constraint);
    const by = red.partners.map(mateOf).filter((x): x is Mate => !!x);
    if (m && by.length) hooks.warn(m.h, `redundant mate: ${m.label} is already implied by ${by.map((p) => `${p.label} (${shortLoc(p.h.loc)})`).join(", ")}`);
  }
  // per-part DOF: rank of the null-space projector restricted to the part's variables
  const dofOf = new Map<Host, number>();
  for (const [h, i] of vix) {
    const P = Array.from({ length: 7 }, (_, a) => Array.from({ length: 7 }, (_, b) => (a === b ? 1 : 0) - an.basis.reduce((s, q) => s + q[i + a]! * q[i + b]!, 0)));
    dofOf.set(h, psdRank(P));
  }
  const allowFree = mateHosts.some((m) => m.assembly.props.allowFree);
  for (const [h, dof] of dofOf) {
    if (dof > 0 && strict) fail(h, `part "${nameOf.get(h)}" is under-constrained: its mates leave ${dof} degree${dof === 1 ? "" : "s"} of freedom`, "drive joints with angle/offset, or use stricter mate types");
    if (dof > 0 && !allowFree) hooks.warn(h, `part "${nameOf.get(h)}" can still move: ${dof} degree${dof === 1 ? "" : "s"} of freedom left by its mates (it stays where it was placed; drive joints with angle/offset)`);
  }

  // apply
  const finalOf = new Map<Host, Mat4>();
  for (const { part, host } of parts) {
    const i = vix.get(host);
    let X = guess.get(host)!;
    if (i !== undefined) X = mul(rigid(r.x, i), X);
    X = tidy(X.map((v) => (Math.abs(v - Math.round(v)) < 1e-10 ? Math.round(v) + 0 : v)));
    finalOf.set(host, X);
    if (isIdentity(X, 1e-12)) continue;
    const node = part.node;
    if (node.type === "transform") (node as { matrix: number[] }).matrix = tidy(mul(X, node.matrix as Mat4));
    else {
      const wrapped = { type: "transform", matrix: X as any, children: [node] } as Node;
      part.node = hooks.emit ? hooks.emit(wrapped, host) : wrapped;
    }
  }

  return {
    parts: parts.map(({ part, host }) => ({ name: part.name ?? "", transform: finalOf.get(host)!, dof: dofOf.get(host) ?? (grounded.has(host) ? 0 : 6), grounded: grounded.has(host) })),
    mates: mates.map((m, k) => {
      const ci = vix.size + k;
      let res = 0;
      r.F.forEach((f, j) => {
        if (r.owner[j] === ci) res = Math.max(res, Math.abs(f));
      });
      return {
        a: m.aName,
        b: m.bName,
        type: m.type,
        ...(m.angle !== undefined ? { angle: m.angle } : {}),
        ...(m.offset !== undefined ? { offset: m.offset } : {}),
        flip: m.flip,
        residual: res,
        ok: true,
        ...(m.h.loc ? { loc: m.h.loc } : {}),
      };
    }),
    anchors: live.map((a) => ({
      part: nameOf.get(a.partHost)!,
      id: a.id,
      frame: tidy(mul(finalOf.get(a.partHost)!, a.frame)),
      ...(a.host.loc ? { loc: a.host.loc } : {}),
    })),
  };
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
