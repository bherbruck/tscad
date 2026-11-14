/**
 * SVG writer: one `<path>` per drawing (group per drawing), true arc commands (`A`),
 * quadratic/cubic Béziers kept as `Q`/`C`, other NURBS flattened. Units are mm
 * (`width="…mm"`); y is flipped so the drawing reads the right way up.
 */
import { TAU, type Loop2 } from "../core/sketch/seg";
import { bounds, flattenNurbs, fmt, layers, type DrawingInput } from "./common";

export interface SvgOptions {
  /** Stroke colour. Default `"#000"`. */
  stroke?: string;
  /** Stroke width, mm. Default 0.1 (a hairline for laser cutters). */
  strokeWidth?: number;
  /** Fill (even-odd, so holes show). Default `"none"`. */
  fill?: string;
  /** Margin around the drawing, mm. Default 1. */
  margin?: number;
  /** Chordal tolerance for flattened NURBS, mm. Default 0.01. */
  tolerance?: number;
}

/** SVG path data for loops (y flipped: pass the result through a viewBox with negated y). */
export function svgPathData(loops: readonly Loop2[], tolerance = 0.01): string {
  const parts: string[] = [];
  const P = (x: number, y: number) => `${fmt(x, 4)} ${fmt(-y, 4)}`;
  for (const loop of loops) {
    const first = loop[0];
    if (!first) continue;
    const st = first.kind === "line" ? first.a : first.kind === "arc" ? [first.c[0] + first.r * Math.cos(first.a0), first.c[1] + first.r * Math.sin(first.a0)] : [first.pts[0]![0], first.pts[0]![1]];
    const d: string[] = [`M${P(st[0]!, st[1]!)}`];
    for (const s of loop) {
      if (s.kind === "line") d.push(`L${P(s.b[0], s.b[1])}`);
      else if (s.kind === "arc") {
        const sweep = s.a1 - s.a0;
        // y is flipped, so a CCW (math) arc is drawn with sweep-flag 0
        const flag = sweep > 0 ? 0 : 1;
        const pieces = Math.abs(Math.abs(sweep) - TAU) < 1e-9 ? 2 : 1; // a full circle needs two arcs
        for (let i = 1; i <= pieces; i++) {
          const t = s.a0 + (sweep * i) / pieces;
          const large = Math.abs(sweep / pieces) > Math.PI + 1e-12 ? 1 : 0;
          d.push(`A${fmt(s.r, 4)} ${fmt(s.r, 4)} 0 ${large} ${flag} ${P(s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t))}`);
        }
      } else {
        const bez = s.knots.length === 2 * (s.degree + 1) && s.pts.every((p) => p[2] === 1);
        if (bez && s.degree === 2) d.push(`Q${P(s.pts[1]![0], s.pts[1]![1])} ${P(s.pts[2]![0], s.pts[2]![1])}`);
        else if (bez && s.degree === 3) d.push(`C${P(s.pts[1]![0], s.pts[1]![1])} ${P(s.pts[2]![0], s.pts[2]![1])} ${P(s.pts[3]![0], s.pts[3]![1])}`);
        else for (const p of flattenNurbs(s, tolerance).slice(1)) d.push(`L${P(p[0], p[1])}`);
      }
    }
    d.push("Z");
    parts.push(d.join(""));
  }
  return parts.join(" ");
}

export function toSVG(input: DrawingInput, o: SvgOptions = {}): string {
  const ls = layers(input, "drawing");
  const m = o.margin ?? 1;
  const [x0, y0, x1, y1] = bounds(ls);
  const w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const groups = ls.map(
    (l) => `  <g id="${esc(l.name)}">\n    <path fill-rule="evenodd" d="${svgPathData(l.loops, o.tolerance)}"/>\n  </g>`,
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w, 4)}mm" height="${fmt(h, 4)}mm" viewBox="${fmt(x0 - m, 4)} ${fmt(-y1 - m, 4)} ${fmt(w, 4)} ${fmt(h, 4)}" fill="${esc(o.fill ?? "none")}" stroke="${esc(o.stroke ?? "#000")}" stroke-width="${fmt(o.strokeWidth ?? 0.1, 4)}">`,
    ...groups,
    `</svg>`,
    "",
  ].join("\n");
}
