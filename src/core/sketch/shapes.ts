/**
 * 2D shape builders. Every builder returns closed loops in the shape's local frame, CCW.
 */
import type { Vec2 } from "../math";
import { arc, line, TAU, type Loop2, type Nurbs2, type Seg2 } from "./seg";

const H = Math.SQRT1_2;

export function rectLoop(w: number, h: number, cx = 0, cy = 0): Loop2 {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return [line([x0, y0], [x1, y0]), line([x1, y0], [x1, y1]), line([x1, y1], [x0, y1]), line([x0, y1], [x0, y0])];
}

export function circleLoop(r: number, c: Vec2 = [0, 0]): Loop2 {
  return [arc(c, r, 0, TAU)];
}

/** A rectangle with its corners rounded by quarter arcs (`r` clamped to half the short side). */
export function roundedRectLoop(w: number, h: number, r: number): Loop2 {
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) return rectLoop(w, h);
  const x = w / 2, y = h / 2;
  const segs: Seg2[] = [];
  const L = (a: Vec2, b: Vec2) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-12) segs.push(line(a, b));
  };
  const P = Math.PI / 2;
  L([-x + r, -y], [x - r, -y]);
  segs.push(arc([x - r, -y + r], r, -P, 0));
  L([x, -y + r], [x, y - r]);
  segs.push(arc([x - r, y - r], r, 0, P));
  L([x - r, y], [-x + r, y]);
  segs.push(arc([-x + r, y - r], r, P, 2 * P));
  L([-x, y - r], [-x, -y + r]);
  segs.push(arc([-x + r, -y + r], r, 2 * P, 3 * P));
  return segs;
}

/** A stadium: overall `length` along X, `width` across (end radius width/2). */
export function slotLoop(length: number, width: number): Loop2 {
  const r = width / 2;
  const a = Math.max(0, length / 2 - r);
  if (a === 0) return circleLoop(r);
  const P = Math.PI / 2;
  return [
    line([-a, -r], [a, -r]),
    arc([a, 0], r, -P, P),
    line([a, r], [-a, r]),
    arc([-a, 0], r, P, 3 * P),
  ];
}

/**
 * A full ellipse as one closed rational quadratic NURBS (the classic 9-point circle, scaled):
 * exact, not an approximation.
 */
export function ellipseLoop(rx: number, ry: number): Loop2 {
  const p: [number, number, number][] = [
    [rx, 0, 1], [rx, ry, H], [0, ry, 1], [-rx, ry, H], [-rx, 0, 1], [-rx, -ry, H], [0, -ry, 1], [rx, -ry, H], [rx, 0, 1],
  ];
  const n: Nurbs2 = { kind: "nurbs", degree: 2, pts: p, knots: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1] };
  return [n];
}

export function polygonLoop(points: readonly Vec2[]): Loop2 {
  const pts = dedupe(points);
  return pts.map((p, i) => line(p, pts[(i + 1) % pts.length]!));
}

function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-12) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) <= 1e-12) out.pop();
  return out;
}

/** Vertices of a regular polygon with circumradius `r`, first vertex at angle `phase` (deg). */
export function regularPolygonPoints(sides: number, r: number, phase = 0): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const t = ((phase + (360 * i) / sides) * Math.PI) / 180;
    return [snap(r * Math.cos(t)), snap(r * Math.sin(t))] as Vec2;
  });
}

/** A star with `points` tips at radius `r1` and valleys at radius `r2`, first tip on +Y. */
export function starPoints(points: number, r1: number, r2: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const t = Math.PI / 2 + (Math.PI * i) / points;
    out.push([snap(r * Math.cos(t)), snap(r * Math.sin(t))]);
  }
  return out;
}

function snap(v: number): number {
  return Math.abs(v) < 1e-12 ? 0 : v;
}
