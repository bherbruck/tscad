/**
 * DXF R12 (AC1009) writer: millimetres, one layer per drawing.
 * - `entities: "primitives"` (default): LINE, ARC (real arcs, CCW degrees), CIRCLE; NURBS as a
 *   POLYLINE flattened to `tolerance`.
 * - `entities: "polyline"`: every loop as one closed POLYLINE, arcs as bulges (exact) — what
 *   many laser/CAM tools prefer (closed contours).
 */
import { TAU, type Arc2, type Loop2 } from "../core/sketch/seg";
import { bounds, flattenNurbs, fmt, layers, type DrawingInput } from "./common";
import type { Vec2 } from "../core/math";

/** Options for {@link toDXF}. */
export interface DxfOptions {
  /** Entity style. Default `"primitives"`. */
  entities?: "primitives" | "polyline";
  /** Chordal tolerance for flattening NURBS (text, ellipses), mm. Default 0.01. */
  tolerance?: number;
  /** Layer name when the input has none (plain loops). Default `"0"`. */
  layer?: string;
}

const deg = (r: number) => {
  let d = (r * 180) / Math.PI;
  d = ((d % 360) + 360) % 360;
  return Math.abs(d - 360) < 1e-9 ? 0 : d;
};
const layerName = (s: string) => s.replace(/[^A-Za-z0-9_\-$]/g, "_").toUpperCase() || "0";

/** DXF R12 text (mm) for drawings or loops; one layer per drawing. */
export function toDXF(input: DrawingInput, o: DxfOptions = {}): string {
  const tol = o.tolerance ?? 0.01;
  const ls = layers(input, o.layer ?? "0");
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === "number" ? fmt(value) : value);
  const [x0, y0, x1, y1] = bounds(ls);

  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$INSUNITS"); g(70, 4);
  g(9, "$MEASUREMENT"); g(70, 1);
  g(9, "$EXTMIN"); g(10, x0); g(20, y0); g(30, 0);
  g(9, "$EXTMAX"); g(10, x1); g(20, y1); g(30, 0);
  g(0, "ENDSEC");

  const names = [...new Set(ls.map((l) => layerName(l.name)))];
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 1);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, names.length);
  for (const n of names) {
    g(0, "LAYER"); g(2, n); g(70, 0); g(62, 7); g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "ENTITIES");
  for (const l of ls) {
    const layer = layerName(l.name);
    for (const loop of l.loops) {
      if (o.entities === "polyline") polyline(loop, layer, g, tol);
      else primitives(loop, layer, g, tol);
    }
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\n") + "\n";
}

type G = (code: number, value: string | number) => void;

function primitives(loop: Loop2, layer: string, g: G, tol: number) {
  for (const s of loop) {
    if (s.kind === "line") {
      g(0, "LINE"); g(8, layer);
      g(10, s.a[0]); g(20, s.a[1]); g(30, 0);
      g(11, s.b[0]); g(21, s.b[1]); g(31, 0);
    } else if (s.kind === "arc") {
      if (Math.abs(Math.abs(s.a1 - s.a0) - TAU) < 1e-9) {
        g(0, "CIRCLE"); g(8, layer); g(10, s.c[0]); g(20, s.c[1]); g(30, 0); g(40, s.r);
      } else {
        const [a, b] = s.a1 > s.a0 ? [s.a0, s.a1] : [s.a1, s.a0]; // DXF arcs are CCW
        g(0, "ARC"); g(8, layer); g(10, s.c[0]); g(20, s.c[1]); g(30, 0); g(40, s.r); g(50, deg(a)); g(51, deg(b));
      }
    } else {
      const pts = flattenNurbs(s, tol);
      g(0, "POLYLINE"); g(8, layer); g(66, 1); g(70, 0); g(10, 0); g(20, 0); g(30, 0);
      for (const p of pts) {
        g(0, "VERTEX"); g(8, layer); g(10, p[0]); g(20, p[1]); g(30, 0);
      }
      g(0, "SEQEND"); g(8, layer);
    }
  }
}

function polyline(loop: Loop2, layer: string, g: G, tol: number) {
  const verts: [Vec2, number][] = []; // point, bulge to the next vertex
  const arcPiece = (s: Arc2, a: number, b: number) => {
    verts.push([[s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)], Math.tan((b - a) / 4)]);
  };
  for (const s of loop) {
    if (s.kind === "line") verts.push([s.a, 0]);
    else if (s.kind === "arc") {
      const sweep = s.a1 - s.a0;
      const n = Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI - 1e-9)); // bulge arcs ≤ 180°
      for (let i = 0; i < n; i++) arcPiece(s, s.a0 + (sweep * i) / n, s.a0 + (sweep * (i + 1)) / n);
    } else {
      const pts = flattenNurbs(s, tol);
      for (const p of pts.slice(0, -1)) verts.push([p, 0]);
    }
  }
  g(0, "POLYLINE"); g(8, layer); g(66, 1); g(70, 1); g(10, 0); g(20, 0); g(30, 0);
  for (const [p, bulge] of verts) {
    g(0, "VERTEX"); g(8, layer); g(10, p[0]); g(20, p[1]); g(30, 0);
    if (bulge) g(42, bulge);
  }
  g(0, "SEQEND"); g(8, layer);
}
