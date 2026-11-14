/** A compiled `<drawing>` as the viewer gets it: loops and open paths as segments, plus text notes. */
import { flattenNurbs } from "../drawing/common";
import type { Drawing, Seg2 } from "../drawing";
import type { DrawingData } from "./protocol";

/** Viewer colours for the usual laser / press-brake layers (a drawing's own `color` wins). */
export const LAYER_COLORS: Record<string, string> = {
  cut: "#ffb020",
  bend: "#3ecf8e",
  engrave: "#f471b5",
  score: "#38bdf8",
  mark: "#a78bfa",
};

/** The viewer's data for a flat drawing. */
export function drawingData(d: Drawing): DrawingData {
  const paths = d.paths ?? [];
  const segments = drawingSegments(d.loops);
  const pathSegments = paths.length ? drawingSegments(paths) : undefined;
  const notes = (d.notes ?? []).map((n) => ({ at: [n.at[0], n.at[1]] as [number, number], text: n.text, size: n.size, ...(n.angle !== undefined ? { angle: n.angle } : {}) }));
  return {
    name: d.name,
    color: d.color ?? (d.layer ? LAYER_COLORS[d.layer] : undefined),
    loops: d.loops.length,
    paths: paths.length,
    ...(d.layer ? { layer: d.layer } : {}),
    segments,
    ...(pathSegments ? { pathSegments } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

/** 2D chains, closed loops or open paths (lines, arcs, NURBS) → line segments on z = 0. */
export function drawingSegments(loops: Seg2[][]): Float32Array {
  const out: number[] = [];
  const push = (pts: [number, number][]) => {
    for (let i = 0; i + 1 < pts.length; i++) out.push(pts[i]![0], pts[i]![1], 0, pts[i + 1]![0], pts[i + 1]![1], 0);
  };
  for (const loop of loops) {
    for (const s of loop) {
      if (s.kind === "line") push([s.a, s.b]);
      else if (s.kind === "arc") {
        const n = Math.max(8, Math.ceil((Math.abs(s.a1 - s.a0) / (Math.PI * 2)) * 96));
        push(Array.from({ length: n + 1 }, (_, i) => {
          const t = s.a0 + ((s.a1 - s.a0) * i) / n;
          return [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)] as [number, number];
        }));
      } else if (s.kind === "nurbs") push(flattenNurbs(s as Parameters<typeof flattenNurbs>[0], 0.02) as [number, number][]);
    }
  }
  return new Float32Array(out);
}
