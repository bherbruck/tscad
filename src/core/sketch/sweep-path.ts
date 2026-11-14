/**
 * `<sweepPath>`: a sweep's path drawn in 2D on a plane — a constraint `<sketch>` (lines, arcs,
 * splines; open or closed) or SVG `<path d>` data — turned into exact 3D IR curves, checked for
 * gaps and for sharp corners (the kernel sweeps exactly piece by piece along lines and arcs, so
 * the path must be tangent-continuous).
 */
import type { Curve } from "../../ir";
import type { Host } from "../render";
import { isConstrainedSketch, type SketchRecorder } from "./constrained";
import { parsePath, PathSyntaxError } from "./path";
import { PLANES, toCurves, type Frame, type PlaneName } from "./place";
import { end, mul2, reverseSeg, start, transformLoop, type Affine2, type Seg2 } from "./seg";

export interface SweepPathContext {
  place2(h: Host): Affine2;
  recorder: SketchRecorder;
  warn(h: Host, message: string): void;
  fail(h: Host, message: string, hint?: string): never;
}

type V2 = [number, number];
const norm = (v: V2): V2 => {
  const l = Math.hypot(v[0], v[1]);
  return l > 0 ? [v[0] / l, v[1] / l] : [0, 0];
};

/** Unit tangent of a segment at its start (`at = 0`) or end (`at = 1`), in travel direction. */
export function segTangent(s: Seg2, at: 0 | 1): V2 {
  switch (s.kind) {
    case "line":
      return norm([s.b[0] - s.a[0], s.b[1] - s.a[1]]);
    case "arc": {
      const t = at ? s.a1 : s.a0, dir = s.a1 > s.a0 ? 1 : -1;
      return [-Math.sin(t) * dir, Math.cos(t) * dir];
    }
    case "nurbs": {
      const P = s.pts;
      const [p, q] = at ? [P[P.length - 2]!, P[P.length - 1]!] : [P[0]!, P[1]!];
      return norm([q[0] - p[0], q[1] - p[1]]);
    }
  }
}

/** The 3D path of a `<sweepPath>` host, for the sweep `parent`. */
export function sweepPathOf(h: Host, parent: Host, ctx: SweepPathContext): { curves: Curve[]; frame: Frame; closed: boolean } {
  const plane = (h.props.plane ?? "XY") as PlaneName;
  if (!(plane in PLANES)) ctx.fail(h, `plane must be "XY", "XZ" or "YZ" (got ${JSON.stringify(h.props.plane)})`);
  const off = h.props.offset ?? 0;
  if (typeof off !== "number" || !Number.isFinite(off)) ctx.fail(h, `offset must be a number (got ${JSON.stringify(off)})`);
  const base = PLANES[plane];
  const frame: Frame = { ...base, origin: [base.n[0] * off, base.n[1] * off, base.n[2] * off] };
  const hooks = { warn: (x: Host, m: string) => ctx.warn(x, m) };

  // pieces in order, each an open chain (or one closed loop)
  const pieces: { segs: Seg2[]; host: Host }[] = [];
  const collect = (kids: Host[], m: Affine2) => {
    for (const c of kids) {
      const mm = mul2(m, ctx.place2(c));
      if (c.tag === "sketch" && isConstrainedSketch(c)) {
        const extra = c.children.filter((k) => k.tag === "path" || k.tag === "sketch");
        pieces.push({ segs: ctx.recorder.solvePath(c, mm, parent, frame, hooks), host: c });
        if (extra.length) collect(extra, mm);
      } else if (c.tag === "sketch") collect(c.children, mm);
      else if (c.tag === "path") {
        if (typeof c.props.d !== "string") ctx.fail(c, 'needs path data d="M ..."');
        let subs;
        try {
          subs = parsePath(c.props.d);
        } catch (e) {
          if (e instanceof PathSyntaxError) ctx.fail(c, `bad path data: ${e.message}`);
          throw e;
        }
        for (const s of subs) pieces.push({ segs: transformLoop(s.segs, mm), host: c });
      } else ctx.fail(c, `<${c.tag}> can't be part of a sweep path`, "draw the path with a constraint <sketch> (lines, arcs) or <path d=\"M ...\" /> data");
    }
  };
  collect(h.children, ctx.place2(h));
  if (!pieces.length || !pieces.some((p) => p.segs.length)) ctx.fail(h, "the sweep path is empty", `<sweepPath plane="XZ"><path d="M0 0 V40 A10 10 0 0 1 20 40" /></sweepPath>`);

  // join the pieces end to end (flipping a piece when it was drawn the other way)
  const size = Math.max(1, ...pieces.flatMap((p) => p.segs.flatMap((s) => [...start(s), ...end(s)].map(Math.abs))));
  const tol = 1e-7 * size;
  const gap = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const chain: Seg2[] = [...pieces[0]!.segs];
  for (const p of pieces.slice(1)) {
    if (!p.segs.length) continue;
    const tail = end(chain[chain.length - 1]!);
    let segs = p.segs;
    if (gap(tail, start(segs[0]!)) > tol) {
      const flipped = [...segs].reverse().map(reverseSeg);
      if (gap(tail, start(flipped[0]!)) <= tol) segs = flipped;
      else if (chain.length === pieces[0]!.segs.length && gap(start(chain[0]!), start(segs[0]!)) <= tol) {
        // the first piece runs the other way
        chain.splice(0, chain.length, ...[...chain].reverse().map(reverseSeg));
      } else {
        const t = tail;
        ctx.fail(p.host, `the sweep path has a gap at (${+t[0].toFixed(4)}, ${+t[1].toFixed(4)}) in its plane`, "each piece must start where the previous one ends");
      }
    }
    chain.push(...segs);
  }
  const closed = gap(start(chain[0]!), end(chain[chain.length - 1]!)) <= tol;

  // sharp corners: the exact sweep needs tangent continuity
  const corners: V2[] = [];
  const joints = closed ? chain.length : chain.length - 1;
  for (let i = 0; i < joints; i++) {
    const a = chain[i]!, b = chain[(i + 1) % chain.length]!;
    const ta = segTangent(a, 1), tb = segTangent(b, 0);
    if (ta[0] * tb[0] + ta[1] * tb[1] < 1 - 1e-9) corners.push(end(a));
  }
  if (corners.length) {
    const list = corners.slice(0, 4).map((p) => `(${+p[0].toFixed(3)}, ${+p[1].toFixed(3)})`).join(", ");
    ctx.warn(h, `the sweep path has ${corners.length} sharp corner${corners.length === 1 ? "" : "s"} at ${list}${corners.length > 4 ? ", ..." : ""}: the sweep is only exact along tangent-continuous lines and arcs and may fail there`);
  }
  return { curves: toCurves(chain, frame), frame, closed };
}
