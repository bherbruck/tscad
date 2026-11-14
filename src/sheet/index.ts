/**
 * Sheet metal: `<sheetMetal>` with a base `<flange>` (a closed 2D sketch) and `<edgeFlange>` /
 * `<hem>` / `<jog>` children hanging from the edges of the flange they're written in. Bends are
 * exact cylindrical sections (revolves of the sheet's cross-section about the bend axis); the
 * flat pattern unfolds every bend by its bend allowance BA = θ·(R + K·T) and comes out as
 * drawings: the outline (layer "cut"), bend lines ("bend") and bend notes ("engrave").
 */
import type { Curve, Node } from "../core/../ir";
import type { Drawing } from "../core/compile";
import type { SourceLoc } from "../core/errors";
import type { Vec2, Vec3 } from "../core/math";
import type { Host } from "../core/render";
import { booleanLoops } from "../core/sketch/boolean";
import { regions, toCurves, type Frame } from "../core/sketch/place";
import { end, line, polyline, reverseLoop, signedArea, start, transformLoop, type Affine2, type Loop2 } from "../core/sketch/seg";
import { layoutText, loadFont } from "../core/text/font";

export const SHEET_TAGS: ReadonlySet<string> = new Set(["flange", "edgeFlange", "hem", "jog"]);
const CHILD_TAGS = new Set(["edgeFlange", "hem", "jog"]);

export interface SheetContext {
  /** 2D children → placed loops (the compiler's sketch()). */
  sketch(children: Host[], m: Affine2, parent: Host): { loop: Loop2; host: Host }[];
  place2(h: Host): Affine2;
  warn(h: Host, message: string): void;
  fail(h: Host, message: string, hint?: string): never;
  emit<T extends Node>(node: T, h: Host): T;
  /** Solved constraint-sketch lines with ids, for `parent`'s last sketch() call (sketch coords). */
  sketchLines(parent: Host): { id: string; from: Vec2; to: Vec2 }[];
}

export interface SheetResult {
  node: Node | null;
  drawings: Drawing[];
}

// ---- small vector kit
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sc = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return l > 0 ? sc(a, 1 / l) : a;
};
const tidy = (a: Vec3): Vec3 => a.map((v) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) : v) + 0) as Vec3;
/** Rotate vector v about unit axis k by angle t. */
function rotV(v: Vec3, k: Vec3, t: number): Vec3 {
  const c = Math.cos(t), s = Math.sin(t);
  return add(add(sc(v, c), sc(cross(k, v), s)), sc(k, dot(k, v) * (1 - c)));
}
const rotP = (p: Vec3, o: Vec3, k: Vec3, t: number): Vec3 => add(o, rotV(sub(p, o), k, t));
const v2 = { add: (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]], sub: (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]], sc: (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k] };

/** A flat panel of the part: its 3D placement and its place in the flat pattern. */
interface Panel {
  host: Host;
  /** Panel 2D (x, y) → 3D: o + x·u + y·v; material from 0 to T along w. */
  o: Vec3;
  u: Vec3;
  v: Vec3;
  w: Vec3;
  /** Panel 2D → flat pattern 2D. */
  flat: Affine2;
  /** Outline (outer loops and holes) in panel 2D. */
  loops: Loop2[];
  /** Named straight edges in panel 2D, as running along the outline (material on the left). */
  edges: Map<string, [Vec2, Vec2]>;
  /** Relief cuts requested by child flanges (panel 2D). */
  cuts: Loop2[];
}

interface Bend {
  host: Host;
  /** The revolve node. */
  node: Node;
  /** Flat: the bend strip loop and the centre line. */
  strip: Loop2;
  centre: [Vec2, Vec2];
  angle: number;
  up: boolean;
  radius: number;
}

const DEG = Math.PI / 180;
const affineApply = (m: Affine2, p: Vec2): Vec2 => [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];

function num(ctx: SheetContext, h: Host, name: string, v: unknown, o: { positive?: boolean; nonNegative?: boolean } = {}): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) ctx.fail(h, `${name} must be a number (got ${JSON.stringify(v)})`);
  if (o.positive && !(v > 0)) ctx.fail(h, `${name} must be greater than 0 (got ${v})`);
  if (o.nonNegative && v < 0) ctx.fail(h, `${name} must not be negative (got ${v})`);
  return v;
}

const rectLoop = (x0: number, y0: number, x1: number, y1: number): Loop2 => [
  line([x0, y0], [x1, y0]), line([x1, y0], [x1, y1]), line([x1, y1], [x0, y1]), line([x0, y1], [x0, y0]),
];

/** Build a `<sheetMetal>` host: the folded solid (or the flat sheet with `flat`) and the flat-pattern drawings. */
export function buildSheet(h: Host, ctx: SheetContext): SheetResult {
  const p = h.props;
  const T = num(ctx, h, "thickness", p.thickness, { positive: true }) ?? ctx.fail(h, "missing thickness", `<sheetMetal thickness={1.5} bendRadius={2}>`);
  const R0 = num(ctx, h, "bendRadius", p.bendRadius, { nonNegative: true }) ?? T;
  const K = num(ctx, h, "kFactor", p.kFactor, { nonNegative: true }) ?? 0.44;
  if (K > 1) ctx.fail(h, `kFactor must be between 0 and 1 (got ${K})`);
  const name = typeof p.name === "string" && p.name ? p.name : "sheet";
  const bases = h.children.filter((c) => c.tag === "flange");
  for (const c of h.children) if (c.tag !== "flange") ctx.fail(c, `<${c.tag}> can't go directly in <sheetMetal>`, "<sheetMetal> holds one base <flange>; edge flanges go inside the flange they hang from");
  if (bases.length !== 1) ctx.fail(h, bases.length ? "a <sheetMetal> has one base <flange>" : "needs a base <flange> with a closed 2D outline", `<sheetMetal thickness={1.5}><flange><rect w={100} h={60} /></flange></sheetMetal>`);

  const panels: Panel[] = [];
  const bends: Bend[] = [];

  // ---- the base panel: on z = 0, material up to T
  const baseHost = bases[0]!;
  const twoD = (x: Host) => x.children.filter((c) => !CHILD_TAGS.has(c.tag));
  const baseLoops = ctx.sketch(twoD(baseHost), ctx.place2(baseHost), baseHost);
  if (!baseLoops.length) ctx.fail(baseHost, "the base flange needs a closed 2D outline");
  const baseRegions = regions(baseLoops.map((l) => l.loop), (l) => l);
  if (baseRegions.length !== 1) ctx.fail(baseHost, `the base flange must be one piece (got ${baseRegions.length} separate outlines)`);
  const outer = ccwLoop(baseRegions[0]!.outer);
  const base: Panel = {
    host: baseHost, o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1], flat: [1, 0, 0, 1, 0, 0],
    loops: [outer, ...baseRegions[0]!.holes.map((x) => reverseLoop(ccwLoop(x)))], edges: baseEdges(outer, ctx.sketchLines(baseHost)), cuts: [],
  };
  panels.push(base);

  // ---- children, depth first
  const attach = (parent: Panel, c: Host) => {
    const cp = c.props;
    const edgeKey = cp.edge;
    if (edgeKey === undefined) ctx.fail(c, "missing edge: which edge it hangs from", `<${c.tag} edge="+y" length={20} />  (keywords +x/-x/+y/-y; a sketch line id; "end"/"left"/"right" on an edge flange)`);
    const edge = findEdge(parent, edgeKey, c, ctx);
    const [A, B] = edge;
    const L2 = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L2 < 1e-9) ctx.fail(c, "the edge has no length");
    const e2: Vec2 = [(B[0] - A[0]) / L2, (B[1] - A[1]) / L2];
    const n2: Vec2 = [e2[1], -e2[0]]; // outward (material on the left of the running edge)
    const inset0 = num(ctx, c, "inset", cp.inset, { nonNegative: true }) ?? 0;
    const inset1 = num(ctx, c, "insetEnd", cp.insetEnd, { nonNegative: true }) ?? inset0;
    const x0 = inset0, x1 = L2 - inset1;
    if (!(x1 - x0 > 1e-9)) ctx.fail(c, `insets leave nothing of the ${L2.toFixed(3)} mm edge`);
    const up = (cp.direction ?? "up") === "up";
    if (cp.direction !== undefined && cp.direction !== "up" && cp.direction !== "down") ctx.fail(c, `direction must be "up" or "down" (got ${JSON.stringify(cp.direction)})`);
    // the bends and panels this element makes (a jog makes two)
    let steps: { angle: number; up: boolean; radius: number; length: number; host: Host }[];
    if (c.tag === "edgeFlange") {
      const angle = num(ctx, c, "angle", cp.angle) ?? 90;
      if (!(angle > 0 && angle <= 180)) ctx.fail(c, `angle must be in (0, 180] degrees (got ${angle})`, `fold the other way with direction="down"`);
      const length = num(ctx, c, "length", cp.length, { positive: true }) ?? ctx.fail(c, "missing length", `<edgeFlange edge="+y" length={20} />`);
      steps = [{ angle, up, radius: num(ctx, c, "bendRadius", cp.bendRadius, { nonNegative: true }) ?? R0, length, host: c }];
    } else if (c.tag === "hem") {
      const gap = num(ctx, c, "gap", cp.gap, { positive: true }) ?? T;
      const length = num(ctx, c, "length", cp.length, { positive: true }) ?? ctx.fail(c, "missing length", `<hem edge="end" length={6} />`);
      steps = [{ angle: 180, up, radius: gap / 2, length, host: c }];
    } else {
      // jog: up by `angle`, a web, back down by `angle`, then `length` — the web sized so the
      // last panel's bottom face sits `offset` from the parent's
      const angle = num(ctx, c, "angle", cp.angle) ?? 90;
      if (!(angle > 0 && angle < 180)) ctx.fail(c, `angle must be in (0, 180) degrees (got ${angle})`);
      const offset = num(ctx, c, "offset", cp.offset, { positive: true }) ?? ctx.fail(c, "missing offset", `<jog edge="end" offset={5} length={15} />`);
      const length = num(ctx, c, "length", cp.length, { positive: true }) ?? ctx.fail(c, "missing length");
      const R = num(ctx, c, "bendRadius", cp.bendRadius, { nonNegative: true }) ?? R0;
      // bottom-face rise is linear in the web length: rise(L) = rise(0) + L·sin(angle)
      const rise = (web: number) => {
        const frames = fold(parent, A, e2, n2, x0, x1, [{ angle, up, radius: R, length: web, host: c }, { angle, up: !up, radius: R, length, host: c }], T, K, null);
        const last = frames[frames.length - 1]!;
        return dot(sub(last.o, parent.o), parent.w) * (up ? 1 : -1);
      };
      const r0 = rise(0), slope = rise(1) - r0;
      const web = (offset - r0) / slope;
      if (!(web >= 0)) ctx.fail(c, `offset ${offset} is too small for two ${angle}° bends of radius ${R} in ${T} mm sheet (needs at least ${(r0).toFixed(3)})`);
      steps = [{ angle, up, radius: R, length: web, host: c }, { angle, up: !up, radius: R, length, host: c }];
    }
    const made = fold(parent, A, e2, n2, x0, x1, steps, T, K, bends);
    // reliefs: notches into the parent at the bend's ends when the flange is narrower than its edge
    const reliefs = cp.reliefs !== false && (inset0 > 0 || inset1 > 0);
    if (reliefs) {
      const rw = num(ctx, c, "reliefWidth", cp.reliefWidth, { positive: true }) ?? T;
      const depth = steps[0]!.radius + T;
      const toPanel = (x: number, y: number): Vec2 => v2.add(v2.add(A, v2.sc(e2, x)), v2.sc(n2, y));
      const notch = (xa: number, xb: number) => {
        const pts = [toPanel(xa, -depth), toPanel(xb, -depth), toPanel(xb, 0.001), toPanel(xa, 0.001)];
        return ccwLoop(pts.map((q, i) => line(q, pts[(i + 1) % 4]!)));
      };
      if (inset0 > 0) parent.cuts.push(notch(x0 - rw, x0));
      if (inset1 > 0) parent.cuts.push(notch(x1, x1 + rw));
    }
    // the last panel: holes (2D children in its coordinates) and its own children
    const last = made[made.length - 1]!;
    const width = x1 - x0, len = steps[steps.length - 1]!.length;
    const holes = ctx.sketch(twoD(c), ctx.place2(c), c).map((l) => l.loop);
    last.loops = [rectLoop(0, 0, width, len), ...holes];
    // the middle panels of a jog are plain webs
    for (const mid of made.slice(0, -1)) {
      const st = steps[made.indexOf(mid)]!;
      mid.loops = [rectLoop(0, 0, width, st.length)];
    }
    for (const pnl of made) {
      pnl.edges = new Map([
        ["end", [[width, pnl === last ? len : steps[made.indexOf(pnl)]!.length], [0, pnl === last ? len : steps[made.indexOf(pnl)]!.length]]],
        ["left", [[0, pnl === last ? len : steps[made.indexOf(pnl)]!.length], [0, 0]]],
        ["right", [[width, 0], [width, pnl === last ? len : steps[made.indexOf(pnl)]!.length]]],
      ]);
      panels.push(pnl);
    }
    for (const g of c.children.filter((k) => CHILD_TAGS.has(k.tag))) attach(last, g);
  };
  for (const c of baseHost.children.filter((k) => CHILD_TAGS.has(k.tag))) attach(base, c);

  // ---- panel regions (outline − holes − reliefs), in panel 2D
  const regionLoops = (pnl: Panel): Loop2[] => {
    const outerL = pnl.loops[0]!;
    const holes = pnl.loops.slice(1);
    const cut = [...holes, ...pnl.cuts];
    if (!cut.length) return [outerL];
    return booleanLoops("difference", [[outerL], ...cut.map((x) => [ccwLoop(x)])]);
  };

  // ---- 3D
  const solids: Node[] = [];
  const flat = p.flat === true;
  if (!flat) {
    for (const pnl of panels) {
      const rl = regionLoops(pnl);
      const f: Frame = { origin: pnl.o, u: pnl.u, v: pnl.v, n: tidy(cross(pnl.u, pnl.v)) };
      for (const r of regions(rl, (l) => l)) {
        const ext = (l: Loop2): Node => ({ type: "extrude", profile: toCurves(l, f), direction: tidy(pnl.w), distance: T });
        const o = ctx.emit(ext(r.outer), pnl.host);
        solids.push(r.holes.length ? ctx.emit({ type: "difference", children: [o, ...r.holes.map(ext)] } as Node, pnl.host) : o);
      }
    }
    for (const b of bends) solids.push(b.node);
  }

  // ---- flat pattern
  const flatOperands = [...panels.map((pnl) => regionLoops(pnl).map((l) => transformLoop(l, pnl.flat))), ...bends.map((b) => [b.strip])];
  const outline = booleanLoops("union", flatOperands.filter((o) => o.length));
  if (flat) {
    const f: Frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
    for (const r of regions(outline, (l) => l)) {
      const ext = (l: Loop2): Node => ({ type: "extrude", profile: toCurves(ccwLoop(l), f), direction: [0, 0, 1], distance: T });
      solids.push(r.holes.length ? ctx.emit({ type: "difference", children: [ext(r.outer), ...r.holes.map(ext)] } as Node, h) : ctx.emit(ext(r.outer), h));
    }
  }
  const drawings: Drawing[] = [];
  const loc: { loc?: SourceLoc } = h.loc ? { loc: h.loc } : {};
  drawings.push({ name: `${name}-flat`, layer: "cut", loops: outline, ...loc });
  if (bends.length) {
    drawings.push({ name: `${name}-bends`, layer: "bend", loops: bends.map((b) => [line(b.centre[0], b.centre[1])]), ...loc });
    const notes = bendNotes(bends, T);
    if (notes.length) drawings.push({ name: `${name}-notes`, layer: "engrave", loops: notes, ...loc });
  }
  const node = solids.length === 0 ? null : solids.length === 1 ? solids[0]! : ctx.emit({ type: "union", children: solids } as Node, h);
  return { node, drawings };
}

/** Make the bends and panels for `steps` hanging from `parent`'s edge (A + x·e2 for x in [x0, x1], outward n2). */
function fold(parent: Panel, A: Vec2, e2: Vec2, n2: Vec2, x0: number, x1: number, steps: { angle: number; up: boolean; radius: number; length: number; host: Host }[], T: number, K: number, bends: Bend[] | null): Panel[] {
  const out: Panel[] = [];
  let cur = parent;
  // the edge in the current panel: start point (at x0), direction, outward normal
  let a2 = v2.add(A, v2.sc(e2, x0)), e = e2, n = n2;
  const width = x1 - x0;
  for (const st of steps) {
    const P = (q: Vec2): Vec3 => add(cur.o, add(sc(cur.u, q[0]), sc(cur.v, q[1])));
    const D = (q: Vec2): Vec3 => add(sc(cur.u, q[0]), sc(cur.v, q[1]));
    const a = P(a2), e3 = unit(D(e)), n3 = unit(D(n)), W = cur.w;
    const s = st.up ? 1 : -1;
    const R = st.radius, th = st.angle * DEG;
    const axisO = add(a, sc(W, st.up ? T + R : -R));
    const k = unit(cross(sc(W, -s), n3));
    // the bend: the panel's end face (along e3 × W) revolved about the axis
    if (bends) {
      const prof: Loop2 = rectLoop(0, 0, width, T);
      const f: Frame = { origin: a, u: e3, v: W, n: tidy(cross(e3, W)) };
      const node: Node = { type: "revolve", profile: toCurves(prof, f) as Curve[], origin: tidy(axisO), axis: tidy(k), angle: th };
      // flat: the strip between the edge and the edge + BA, in the flat pattern
      const BA = th * (R + K * T);
      const F = (x: number, y: number): Vec2 => affineApply(cur.flat, v2.add(v2.add(a2, v2.sc(e, x)), v2.sc(n, y)));
      const pts = [F(0, 0), F(width, 0), F(width, BA), F(0, BA)];
      bends.push({ host: st.host, node, strip: ccwLoop(pts.map((q, i) => line(q, pts[(i + 1) % 4]!))), centre: [F(0, BA / 2), F(width, BA / 2)], angle: st.angle, up: st.up, radius: R });
    }
    // the next panel: the edge frame rotated about the axis
    const o = rotP(a, axisO, k, th);
    const pu = rotV(e3, k, th), pv = rotV(n3, k, th), pw = rotV(W, k, th);
    const BA = th * (R + K * T);
    // flat: panel 2D (x along the edge, y away from the bend) → flat
    const fo = affineApply(cur.flat, v2.add(a2, v2.sc(n, BA)));
    const fe = (() => {
      const q0 = affineApply(cur.flat, [0, 0]), q1 = affineApply(cur.flat, e);
      return v2.sub(q1, q0);
    })();
    const fn = (() => {
      const q0 = affineApply(cur.flat, [0, 0]), q1 = affineApply(cur.flat, n);
      return v2.sub(q1, q0);
    })();
    const panel: Panel = {
      host: st.host, o: tidy(o), u: tidy(pu), v: tidy(pv), w: tidy(pw),
      flat: [fe[0], fn[0], fe[1], fn[1], fo[0], fo[1]],
      loops: [], edges: new Map(), cuts: [],
    };
    out.push(panel);
    // next step (a jog's second bend) continues from this panel's far edge, x running the same way
    cur = panel;
    a2 = [0, st.length];
    e = [1, 0];
    n = [0, 1];
  }
  return out;
}

/** The outline's straight edges by name: keywords by outward normal, indices, sketch line ids. */
function baseEdges(outer: Loop2, sketchLines: { id: string; from: Vec2; to: Vec2 }[]): Map<string, [Vec2, Vec2]> {
  const m = new Map<string, [Vec2, Vec2]>();
  outer.forEach((s, i) => {
    if (s.kind !== "line") return;
    m.set(String(i), [s.a, s.b]);
  });
  for (const l of sketchLines) {
    const seg = outer.find((s) => s.kind === "line" && ((near(s.a, l.from) && near(s.b, l.to)) || (near(s.a, l.to) && near(s.b, l.from))));
    if (seg && seg.kind === "line") m.set(l.id, [seg.a, seg.b]);
  }
  return m;
}
const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6 * Math.max(1, Math.hypot(...a));

const KEYWORDS: Record<string, Vec2> = { "+x": [1, 0], "-x": [-1, 0], "+y": [0, 1], "-y": [0, -1], right: [1, 0], left: [-1, 0], back: [0, 1], top: [0, 1], front: [0, -1], bottom: [0, -1] };

function findEdge(pnl: Panel, key: unknown, h: Host, ctx: SheetContext): [Vec2, Vec2] {
  if (typeof key === "number") key = String(key);
  if (typeof key !== "string") ctx.fail(h, `edge must be a name or an index (got ${JSON.stringify(key)})`);
  const named = pnl.edges.get(key);
  if (named) return named;
  const dir = KEYWORDS[key];
  if (dir && pnl.loops[0]) {
    // straight edges of the outline whose outward normal points along `dir`
    const cands = pnl.loops[0].filter((s) => {
      if (s.kind !== "line") return false;
      const d: Vec2 = [s.b[0] - s.a[0], s.b[1] - s.a[1]], l = Math.hypot(...d);
      const nrm: Vec2 = [d[1] / l, -d[0] / l];
      return nrm[0] * dir[0] + nrm[1] * dir[1] > 1 - 1e-9;
    });
    if (cands.length === 1) return [start(cands[0]!), end(cands[0]!)];
    if (cands.length > 1) {
      // the outermost one
      const best = cands.reduce((a, b) => (start(b)[0] * dir[0] + start(b)[1] * dir[1] > start(a)[0] * dir[0] + start(a)[1] * dir[1] ? b : a));
      return [start(best), end(best)];
    }
  }
  const known = [...pnl.edges.keys()].filter((k) => !/^\d+$/.test(k));
  return ctx.fail(h, `no edge "${key}" here`, `edges: ${[...(pnl === undefined ? [] : known), "+x", "-x", "+y", "-y", "or an outline index"].join(", ")}`);
}

function ccwLoop(l: Loop2): Loop2 {
  return signedArea(polyline(l)) < 0 ? reverseLoop(l) : l;
}

/** "UP 90° R2" labels beside each bend line, as text outlines. */
function bendNotes(bends: Bend[], T: number): Loop2[] {
  const font = loadFont(undefined);
  const out: Loop2[] = [];
  for (const b of bends) {
    const [p0, p1] = b.centre;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const size = Math.max(1.5, Math.min(5, len / 12, 3 * T));
    const label = `${b.up ? "UP" : "DN"} ${+b.angle.toFixed(2)}° R${+b.radius.toFixed(3)}`;
    const t = layoutText(label, font, { size, align: "center", valign: "middle", spacing: 1, lineHeight: 1.2, kerning: true, ligatures: false });
    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    // keep text readable (not upside down)
    const a = ang > Math.PI / 2 || ang <= -Math.PI / 2 ? ang + Math.PI : ang;
    const mid: Vec2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const nrm: Vec2 = [-Math.sin(a), Math.cos(a)];
    const at = v2.add(mid, v2.sc(nrm, size * 0.9));
    const cs = Math.cos(a), sn = Math.sin(a);
    for (const l of t.loops) out.push(transformLoop(l, [cs, -sn, sn, cs, at[0], at[1]]));
  }
  return out;
}
