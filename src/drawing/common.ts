import type { Drawing, DrawingNote } from "../core/compile";
import type { Vec2 } from "../core/math";
import { line, nurbsPoint, type Loop2, type Nurbs2, type Seg2 } from "../core/sketch/seg";

/** What the writers accept: drawings, loops, or closed polylines (e.g. from `section`). */
export type DrawingInput = Drawing | readonly Drawing[] | readonly Loop2[] | { loops: readonly Loop2[]; paths?: readonly (readonly Seg2[])[]; notes?: readonly DrawingNote[]; name?: string; layer?: string };

/** A named set of loops (one layer / SVG group). */
export interface Layer {
  name: string;
  loops: readonly Loop2[];
  /** Open paths (not closed). */
  paths?: readonly (readonly Seg2[])[];
  /** Text notes. */
  notes?: readonly DrawingNote[];
  /** Output layer (DXF layer, SVG `data-layer`); default the name. */
  layer?: string;
}

export function layers(input: DrawingInput, fallback = "0"): Layer[] {
  if (Array.isArray(input)) {
    if (input.length === 0) return [];
    if (isDrawing(input[0])) return (input as Drawing[]).map((d) => layerOf(d, d.name));
    return [{ name: fallback, loops: input as Loop2[] }];
  }
  const d = input as Exclude<DrawingInput, readonly unknown[]>;
  return [layerOf(d, d.name ?? fallback)];
}

function layerOf(d: Exclude<DrawingInput, readonly unknown[]>, name: string): Layer {
  return { name, loops: d.loops, ...(d.paths?.length ? { paths: d.paths } : {}), ...(d.notes?.length ? { notes: d.notes } : {}), ...(d.layer ? { layer: d.layer } : {}) };
}

function isDrawing(x: unknown): x is Drawing {
  return typeof x === "object" && x !== null && !Array.isArray(x) && "loops" in x;
}

/** Closed polylines → loops of lines. */
export function polylineLoops(polys: readonly (readonly Vec2[])[]): Loop2[] {
  return polys
    .filter((p) => p.length >= 3)
    .map((p) => p.map((q, i) => line([q[0], q[1]], [p[(i + 1) % p.length]![0], p[(i + 1) % p.length]![1]])));
}

/** Flatten a NURBS to points within `tol` (chordal), both ends included. */
export function flattenNurbs(s: Nurbs2, tol: number): Vec2[] {
  const u0 = s.knots[0]!, u1 = s.knots[s.knots.length - 1]!;
  // split at internal knots so each span is a polynomial piece, then subdivide adaptively
  const breaks = [...new Set(s.knots.filter((k) => k > u0 && k < u1))];
  const spans = [u0, ...breaks, u1];
  const out: Vec2[] = [nurbsPoint(s, u0)];
  const rec = (a: number, b: number, pa: Vec2, pb: Vec2, depth: number) => {
    const m = (a + b) / 2;
    const pm = nurbsPoint(s, m);
    const q1 = nurbsPoint(s, a + (b - a) * 0.25), q3 = nurbsPoint(s, a + (b - a) * 0.75);
    const err = Math.max(dist(pm, mid(pa, pb)), dist(q1, mid(pa, pm)), dist(q3, mid(pm, pb)));
    if (depth < 12 && (err > tol || depth < 1)) {
      rec(a, m, pa, pm, depth + 1);
      rec(m, b, pm, pb, depth + 1);
    } else out.push(pb);
  };
  for (let i = 0; i + 1 < spans.length; i++) rec(spans[i]!, spans[i + 1]!, nurbsPoint(s, spans[i]!), nurbsPoint(s, spans[i + 1]!), 0);
  return out;
}
const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A number for text output: fixed precision, no exponent, no "-0". */
export function fmt(v: number, digits = 6): string {
  const s = v.toFixed(digits).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

/** Bounding box of loops (arcs by sampling extremes). */
export function bounds(ls: readonly Layer[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const p = (x: number, y: number) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  for (const l of ls) {
    for (const n of l.notes ?? []) {
      // roughly: the note's box (centred, ~0.6 em per character), rotated
      const hw = (n.text.length * n.size * 0.6) / 2, hh = n.size / 2;
      const a = ((n.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
      for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const) p(n.at[0] + c * x - sn * y, n.at[1] + sn * x + c * y);
    }
    for (const loop of [...l.loops, ...(l.paths ?? [])])
      for (const s of loop) {
        if (s.kind === "line") {
          p(...s.a);
          p(...s.b);
        } else if (s.kind === "nurbs") for (const q of s.pts) p(q[0], q[1]);
        else {
          const lo = Math.min(s.a0, s.a1), hi = Math.max(s.a0, s.a1);
          p(s.c[0] + s.r * Math.cos(s.a0), s.c[1] + s.r * Math.sin(s.a0));
          p(s.c[0] + s.r * Math.cos(s.a1), s.c[1] + s.r * Math.sin(s.a1));
          for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) {
            const t = k * (Math.PI / 2);
            p(s.c[0] + s.r * Math.round(Math.cos(t)), s.c[1] + s.r * Math.round(Math.sin(t)));
          }
        }
      }
  }
  if (x0 === Infinity) return [0, 0, 0, 0];
  return [x0, y0, x1, y1];
}
