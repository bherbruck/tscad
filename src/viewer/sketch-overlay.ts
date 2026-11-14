/**
 * Constraint-sketch overlay: each solved `<sketch>` drawn on its plane: curves (construction
 * dashed), points (free ones orange), and dimension annotations with extension lines, arrows
 * and screen-facing labels you can click. Fades as the camera turns edge-on to a sketch plane.
 */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { SketchData, SketchDimensionData, SketchPatternData } from "./protocol";
import type { Viewport } from "./scene";

type V2 = [number, number];

const COLORS = {
  curve: "#5eead4",
  construction: "#5eead4",
  point: "#e2e8f0",
  free: "#ff9f1c",
  dim: "#93b4ff",
  copy: "#a7f3e7",
  pattern: "#ffb020",
};

interface SketchView {
  data: SketchData;
  index: number;
  group: THREE.Group;
  mats: LineMaterial[];
  pointMats: THREE.PointsMaterial[];
  labels: { el: HTMLElement; world: THREE.Vector3 }[];
  normal: THREE.Vector3;
  center: THREE.Vector3;
  opacity: number;
}

let dotTexture: THREE.Texture | undefined;
function dot(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "rgba(10,12,18,0.9)";
  g.stroke();
  dotTexture = new THREE.CanvasTexture(c);
  dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}

/** Constraint sketches drawn over the model: curves, dimensions, patterns and drag handles. */
export class SketchOverlay {
  readonly root = new THREE.Group();
  #views: SketchView[] = [];
  #visible = true;
  #tmp = new THREE.Vector3();
  /** A dimension label was clicked. */
  onDimensionClick: (sketch: SketchData, dim: SketchDimensionData) => void = () => {};
  /** A pattern label (×6, mirror) was clicked. */
  onPatternClick: (sketch: SketchData, pattern: SketchPatternData) => void = () => {};

  constructor(readonly viewport: Viewport) {
    this.root.renderOrder = 50;
    viewport.scene.add(this.root);
    viewport.beforeRender.push(() => this.#fade());
    viewport.afterRender.push(() => this.#placeLabels());
  }

  get count() {
    return this.#views.length;
  }

  get visible() {
    return this.#visible;
  }

  setVisible(on: boolean) {
    this.#visible = on;
    this.root.visible = on;
    for (const v of this.#views) for (const l of v.labels) l.el.style.display = on ? "" : "none";
    this.viewport.requestRender();
  }

  // ── drag-to-edit: picking points, mapping the cursor into a sketch, a live preview

  /** The sketch point under the cursor (within 9 px), when the overlay is shown. */
  pickPoint(clientX: number, clientY: number): { sketch: number; id: string; free: boolean } | undefined {
    if (!this.#visible) return undefined;
    const r = this.viewport.canvas.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    let best: { sketch: number; id: string; free: boolean } | undefined;
    let bestD = 9;
    for (const v of this.#views) {
      if (v.opacity < 0.2) continue;
      for (const p of v.data.points) {
        const q = this.#tmp.set(p.x, p.y, 0).applyMatrix4(v.group.matrix).project(this.viewport.camera);
        if (q.z > 1) continue;
        const d = Math.hypot(((q.x + 1) / 2) * r.width - mx, ((1 - q.y) / 2) * r.height - my);
        if (d < bestD) {
          bestD = d;
          best = { sketch: v.index, id: p.id, free: p.free };
        }
      }
    }
    return best;
  }

  /** The cursor in sketch `index`'s own coordinates (ray ∩ its plane). */
  toSketch(index: number, clientX: number, clientY: number): [number, number] | undefined {
    const v = this.#views[index];
    if (!v) return undefined;
    const origin = new THREE.Vector3().setFromMatrixPosition(v.group.matrix);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(v.normal, origin);
    const hit = this.viewport.raycasterAt(clientX, clientY).ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return undefined;
    hit.applyMatrix4(new THREE.Matrix4().copy(v.group.matrix).invert());
    return [hit.x, hit.y];
  }

  #preview?: { index: number; group: THREE.Group; mats: LineMaterial[]; pointMat?: THREE.PointsMaterial };

  /** Draw a dragged solution over sketch `index` (its own drawing dimmed). */
  showPreview(index: number, entities: SketchData["entities"], points: { id: string; x: number; y: number }[], dragged: string, reached: boolean) {
    this.clearPreview();
    const v = this.#views[index];
    if (!v) return;
    const group = new THREE.Group();
    const segs: number[] = [];
    for (const e of entities) {
      if (e.construction) continue;
      const pts = entityPoints(e);
      for (let i = 0; i + 1 < pts.length; i++) segs.push(pts[i]![0], pts[i]![1], 0, pts[i + 1]![0], pts[i + 1]![1], 0);
    }
    const mats: LineMaterial[] = [];
    if (segs.length) {
      const g = new LineSegmentsGeometry();
      g.setPositions(segs);
      const m = this.viewport.lineMaterial(reached ? "#ffb020" : "#ff6b6b", 2.4);
      m.depthTest = false;
      m.transparent = true;
      mats.push(m);
      const l = new LineSegments2(g, m);
      l.renderOrder = 66;
      group.add(l);
    }
    const p = points.find((x) => x.id === dragged);
    let pointMat: THREE.PointsMaterial | undefined;
    if (p) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([p.x, p.y, 0], 3));
      pointMat = new THREE.PointsMaterial({ color: reached ? "#ffb020" : "#ff6b6b", size: 14, sizeAttenuation: false, map: dot(), transparent: true, depthTest: false, alphaTest: 0.05 });
      const pts = new THREE.Points(g, pointMat);
      pts.renderOrder = 67;
      group.add(pts);
    }
    v.group.add(group);
    for (const m of v.mats) m.userData.dim = true;
    this.#preview = { index, group, mats, pointMat };
    this.viewport.requestRender();
  }

  clearPreview() {
    const pv = this.#preview;
    if (!pv) return;
    pv.group.removeFromParent();
    pv.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of pv.mats) this.viewport.releaseLineMaterial(m);
    pv.pointMat?.dispose();
    for (const m of this.#views[pv.index]?.mats ?? []) m.userData.dim = false;
    this.#preview = undefined;
    this.viewport.requestRender();
  }

  set(sketches: SketchData[]) {
    this.clearPreview();
    this.clear();
    sketches.forEach((s, i) => this.#views.push(this.#build(s, i)));
    this.setVisible(this.#visible);
  }

  clear() {
    for (const v of this.#views) {
      v.group.removeFromParent();
      v.group.traverse((o) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
      for (const m of v.mats) this.viewport.releaseLineMaterial(m);
      for (const m of v.pointMats) m.dispose();
      for (const l of v.labels) l.el.remove();
    }
    this.#views = [];
    this.viewport.requestRender();
  }

  /** Sketch-space bounds (for sizing annotations). */
  #size(s: SketchData): { size: number; centroid: V2 } {
    const xs: number[] = [], ys: number[] = [];
    for (const p of s.points) xs.push(p.x), ys.push(p.y);
    for (const e of s.entities) {
      if (e.kind === "circle" || e.kind === "arc") xs.push(e.center[0] - e.radius, e.center[0] + e.radius), ys.push(e.center[1] - e.radius, e.center[1] + e.radius);
    }
    if (!xs.length) return { size: 10, centroid: [0, 0] };
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { size: Math.max(Math.hypot(maxX - minX, maxY - minY), 1), centroid: [(minX + maxX) / 2, (minY + maxY) / 2] };
  }

  #build(s: SketchData, index: number): SketchView {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    const m = s.plane;
    group.matrix.set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!, m[9]!, m[10]!, m[11]!, m[12] ?? 0, m[13] ?? 0, m[14] ?? 0, m[15] ?? 1);
    group.matrixWorldNeedsUpdate = true;
    this.root.add(group);
    const view: SketchView = { data: s, index, group, mats: [], pointMats: [], labels: [], normal: new THREE.Vector3(m[2], m[6], m[10]).normalize(), center: new THREE.Vector3(), opacity: 1 };
    const { size, centroid } = this.#size(s);
    view.center.set(centroid[0], centroid[1], 0).applyMatrix4(group.matrix);

    // Curves.
    const solid: number[] = [], dashed: number[] = [], copies: number[] = [];
    for (const e of s.entities) {
      const pts = entityPoints(e);
      // Pattern copies are tinted lighter than their originals.
      const out = e.construction ? dashed : e.copyOf ? copies : solid;
      for (let i = 0; i + 1 < pts.length; i++) out.push(pts[i]![0], pts[i]![1], 0, pts[i + 1]![0], pts[i + 1]![1], 0);
    }
    if (solid.length) group.add(this.#lines(view, solid, COLORS.curve, 2));
    if (copies.length) {
      const l = this.#lines(view, copies, COLORS.copy, 1.6);
      l.material.userData.base = 0.6;
      group.add(l);
    }
    if (dashed.length) {
      const l = this.#lines(view, dashed, COLORS.construction, 1.4);
      const mat = l.material as LineMaterial;
      mat.dashed = true;
      mat.dashSize = size * 0.018;
      mat.gapSize = size * 0.014;
      mat.userData.base = 0.75;
      l.computeLineDistances();
      group.add(l);
    }

    // Patterns: a dashed mirror axis; an arc with the count at a circular pattern's centre; an
    // arrow along a linear pattern's step. Their labels go to the pattern's source.
    const patDashed: number[] = [], patSolid: number[] = [];
    (s.patterns ?? []).forEach((p) => {
      const n = p.copies.length + 1;
      let label: V2 | undefined;
      if (p.kind === "mirror" && p.axis) {
        const [a, b] = p.axis;
        const u = unit(sub(b, a));
        const half = size * 0.6;
        const mid = mul(add(a, b), 0.5);
        const e0 = sub(mid, mul(u, half)), e1 = add(mid, mul(u, half));
        patDashed.push(e0[0], e0[1], 0, e1[0], e1[1], 0);
        label = add(e1, mul(u, size * 0.04));
      } else if (p.kind === "circular" && p.center) {
        const r0 = size * 0.08;
        const sweep = THREE.MathUtils.degToRad(Math.abs(p.angle ?? 360 / n) * Math.max(1, n - 1));
        const pts = arcPts(p.center, r0, 0, Math.min(sweep, Math.PI * 1.9));
        for (let i = 0; i + 1 < pts.length; i++) patSolid.push(pts[i]![0], pts[i]![1], 0, pts[i + 1]![0], pts[i + 1]![1], 0);
        const end = pts[pts.length - 1]!, prev = pts[pts.length - 2]!;
        const u = unit(sub(end, prev)), nrm = perp(u), k = size * 0.02;
        for (const sgn of [1, -1]) {
          const w = add(sub(end, mul(u, k)), mul(nrm, sgn * k * 0.5));
          patSolid.push(end[0], end[1], 0, w[0], w[1], 0);
        }
        label = add(p.center, [r0 * 0.7, -r0 * 0.7]);
      } else if (p.kind === "linear" && p.step) {
        const firstEnt = s.entities[p.of[0] ?? -1];
        const from = firstEnt ? centroidOf(entityPoints(firstEnt)) : [0, 0];
        const to = add(from as V2, mul(p.step, n - 1));
        patSolid.push(from[0]!, from[1]!, 0, to[0], to[1], 0);
        label = add(mul(add(from as V2, to), 0.5), mul(unit(perp(p.step)), size * 0.04));
      }
      if (!label) return;
      const el = document.createElement("button");
      el.className = "dim-label pattern-label";
      el.textContent = p.kind === "mirror" ? "mirror" : `×${n}${p.kind === "circular" && p.angle ? ` · ${+p.angle.toFixed(2)}°` : ""}`;
      el.title = `${p.kind} pattern of ${p.of.length} entit${p.of.length === 1 ? "y" : "ies"}${p.loc ? ` · ${shortFile(p.loc.file)}:${p.loc.line}` : ""}. Click to find in code`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onPatternClick(s, p);
      });
      el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      this.viewport.labelLayer.appendChild(el);
      view.labels.push({ el, world: new THREE.Vector3(label[0], label[1], 0).applyMatrix4(group.matrix) });
    });
    if (patSolid.length) group.add(this.#lines(view, patSolid, COLORS.pattern, 1.4));
    if (patDashed.length) {
      const l = this.#lines(view, patDashed, COLORS.pattern, 1.4);
      l.material.dashed = true;
      l.material.dashSize = size * 0.025;
      l.material.gapSize = size * 0.018;
      l.material.userData.base = 0.85;
      l.computeLineDistances();
      group.add(l);
    }

    // Points: fixed/solved white, free orange (and larger).
    for (const free of [false, true]) {
      const pts = s.points.filter((p) => p.free === free);
      if (!pts.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, 0]), 3));
      const mat = new THREE.PointsMaterial({ color: free ? COLORS.free : COLORS.point, size: free ? 11 : 7, sizeAttenuation: false, map: dot(), transparent: true, depthTest: false, alphaTest: 0.05 });
      view.pointMats.push(mat);
      const p = new THREE.Points(g, mat);
      p.renderOrder = 62;
      group.add(p);
    }

    // Dimensions.
    const dimSegs: number[] = [];
    const levels = stackLevels(s.dimensions, centroid);
    s.dimensions.forEach((d, di) => {
      const a = annotate(d, size, centroid, levels[di] ?? 0);
      if (!a) return;
      for (const sg of a.segments) dimSegs.push(sg[0], sg[1], 0, sg[2], sg[3], 0);
      const el = document.createElement("button");
      el.className = "dim-label";
      el.textContent = d.text;
      el.title = `${d.kind}${d.loc ? ` · ${shortFile(d.loc.file)}:${d.loc.line}` : ""}. Click to find in code`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onDimensionClick(s, d);
      });
      el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      this.viewport.labelLayer.appendChild(el);
      view.labels.push({ el, world: new THREE.Vector3(a.label[0], a.label[1], 0).applyMatrix4(group.matrix) });
    });
    if (dimSegs.length) group.add(this.#lines(view, dimSegs, COLORS.dim, 1.1));
    group.updateMatrixWorld(true);
    return view;
  }

  #lines(view: SketchView, segs: number[], color: string, width: number): LineSegments2 {
    const g = new LineSegmentsGeometry();
    g.setPositions(segs);
    const mat = this.viewport.lineMaterial(color, width);
    mat.depthTest = false;
    mat.transparent = true;
    view.mats.push(mat);
    const l = new LineSegments2(g, mat);
    l.renderOrder = 60;
    return l;
  }

  /** Edge-on sketches fade out; face-on ones are fully drawn. */
  #fade() {
    if (!this.#visible) return;
    const cam = this.viewport.camera;
    const dir = new THREE.Vector3();
    for (const v of this.#views) {
      if ((cam as THREE.OrthographicCamera).isOrthographicCamera) cam.getWorldDirection(dir).negate();
      else dir.copy(cam.position).sub(v.center).normalize();
      const f = Math.abs(dir.dot(v.normal));
      const o = Math.min(1, Math.max(0, (f - 0.08) / 0.32));
      v.opacity = o;
      v.group.visible = o > 0.02;
      for (const m of v.mats) m.opacity = o * (m.userData.base ?? 1) * (m.userData.dim ? 0.3 : 1);
      for (const m of v.pointMats) m.opacity = o;
    }
  }

  #placeLabels() {
    if (!this.#visible) return;
    const { x: w, y: h } = this.viewport.size;
    const cam = this.viewport.camera;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const v of this.#views) {
      for (const l of v.labels) {
        const p = this.#tmp.copy(l.world).project(cam);
        const on = v.opacity > 0.05 && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
        l.el.style.display = on ? "" : "none";
        if (!on) continue;
        let x = ((p.x + 1) / 2) * w, y = ((1 - p.y) / 2) * h;
        const bw = l.el.offsetWidth || 30, bh = l.el.offsetHeight || 16;
        // Nudge a label off the ones already placed (a few tries, then accept the overlap).
        for (let t = 0; t < 6; t++) {
          const hit = placed.find((q) => Math.abs(q.x - x) < (q.w + bw) / 2 + 2 && Math.abs(q.y - y) < (q.h + bh) / 2 + 1);
          if (!hit) break;
          y = hit.y + (y >= hit.y ? 1 : -1) * ((hit.h + bh) / 2 + 2);
        }
        placed.push({ x, y, w: bw, h: bh });
        l.el.style.opacity = String(v.opacity);
        l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }
    }
  }
}

// ───────────────────────── geometry ─────────────────────────

function entityPoints(e: SketchData["entities"][number]): V2[] {
  switch (e.kind) {
    case "line":
      return [e.from, e.to];
    case "circle":
      return arcPts(e.center, e.radius, 0, Math.PI * 2);
    case "arc": {
      const a0 = Math.atan2(e.from[1] - e.center[1], e.from[0] - e.center[0]);
      let a1 = Math.atan2(e.to[1] - e.center[1], e.to[0] - e.center[0]);
      if (e.ccw) {
        while (a1 <= a0 + 1e-9) a1 += Math.PI * 2;
      } else {
        while (a1 >= a0 - 1e-9) a1 -= Math.PI * 2;
      }
      return arcPts(e.center, e.radius, a0, a1);
    }
    case "spline":
      return bspline(e.points, e.degree);
  }
}

function arcPts(c: V2, r: number, a0: number, a1: number): V2[] {
  const n = Math.max(6, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 96));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / n;
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)] as V2;
  });
}

/** Clamped uniform B-spline through its end control points (de Boor). */
export function bspline(ctrl: V2[], degree: number): V2[] {
  const n = ctrl.length;
  const p = Math.min(degree, n - 1);
  if (p < 1) return ctrl;
  const knots: number[] = [];
  for (let i = 0; i <= p; i++) knots.push(0);
  for (let i = 1; i < n - p; i++) knots.push(i / (n - p));
  for (let i = 0; i <= p; i++) knots.push(1);
  const at = (u: number): V2 => {
    let k = p;
    while (k < n - 1 && u >= knots[k + 1]!) k++;
    const d = Array.from({ length: p + 1 }, (_, j) => [...ctrl[k - p + j]!] as V2);
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const den = knots[i + p - r + 1]! - knots[i]!;
        const a = den === 0 ? 0 : (u - knots[i]!) / den;
        d[j] = [(1 - a) * d[j - 1]![0] + a * d[j]![0], (1 - a) * d[j - 1]![1] + a * d[j]![1]];
      }
    }
    return d[p]!;
  };
  const steps = 24 * (n - 1);
  const out: V2[] = [];
  for (let i = 0; i <= steps; i++) out.push(at(Math.min(i / steps, 1 - 1e-12)));
  out[out.length - 1] = ctrl[n - 1]!;
  return out;
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const unit = (a: V2): V2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const perp = (a: V2): V2 => [-a[1], a[0]];

interface Annotation {
  segments: [number, number, number, number][];
  label: V2;
}

/** Extension lines, dimension line, arrows and label anchor for one dimension (sketch coords). */
export function annotate(d: SketchDimensionData, size: number, centroid: V2, level = 0): Annotation | undefined {
  const o0 = size * 0.09;
  // Stacked dimensions on the same side step outwards (like baseline dimensions in a drawing).
  const o = o0 * (1 + level * 0.85);
  const k = size * 0.025;
  const segs: Annotation["segments"] = [];
  const line = (a: V2, b: V2) => segs.push([a[0], a[1], b[0], b[1]]);
  /** Arrowhead at `tip`, pointing along `dir`. */
  const arrow = (tip: V2, dir: V2) => {
    const u = unit(dir), n = perp(u);
    line(tip, add(sub(tip, mul(u, k)), mul(n, k * 0.4)));
    line(tip, sub(sub(tip, mul(u, k)), mul(n, k * 0.4)));
  };
  /** Away from the sketch's middle. */
  const away = (at: V2, n: V2): V2 => ((at[0] - centroid[0]) * n[0] + (at[1] - centroid[1]) * n[1] < 0 ? mul(n, -1) : n);
  const dimLine = (a2: V2, b2: V2) => {
    line(a2, b2);
    const u = sub(b2, a2);
    if (len(u) > k * 2.5) {
      arrow(a2, mul(u, -1));
      arrow(b2, u);
    }
  };
  const p = d.points as V2[];
  switch (d.kind) {
    case "distance":
    case "length": {
      const [a, b] = p as [V2, V2];
      if (!a || !b || len(sub(b, a)) < 1e-9) return undefined;
      const u = unit(sub(b, a));
      const n = away(mul(add(a, b), 0.5), perp(u));
      const a2 = add(a, mul(n, o)), b2 = add(b, mul(n, o));
      line(a, add(a2, mul(n, o * 0.2)));
      line(b, add(b2, mul(n, o * 0.2)));
      dimLine(a2, b2);
      return { segments: segs, label: add(mul(add(a2, b2), 0.5), mul(n, o * 0.32)) };
    }
    case "dx":
    case "dy": {
      const [a, b] = p as [V2, V2];
      if (!a || !b) return undefined;
      const ax = d.kind === "dx" ? 0 : 1, other = 1 - ax;
      const mid = mul(add(a, b), 0.5);
      const side = mid[other]! - centroid[other]! >= 0 ? 1 : -1;
      const level = side > 0 ? Math.max(a[other]!, b[other]!) + o : Math.min(a[other]!, b[other]!) - o;
      const proj = (q: V2): V2 => (ax === 0 ? [q[0], level] : [level, q[1]]);
      const a2 = proj(a), b2 = proj(b);
      const over: V2 = ax === 0 ? [0, side * o0 * 0.2] : [side * o0 * 0.2, 0];
      line(a, add(a2, over));
      line(b, add(b2, over));
      dimLine(a2, b2);
      const lab = mul(add(a2, b2), 0.5);
      return { segments: segs, label: add(lab, ax === 0 ? [0, side * o0 * 0.32] : [side * o0 * 0.32, 0]) };
    }
    case "radius": {
      const [c, q] = p as [V2, V2];
      if (!c || !q) return undefined;
      line(c, q);
      arrow(q, sub(q, c));
      return { segments: segs, label: add(mul(add(c, q), 0.5), mul(unit(perp(sub(q, c))), o * 0.3)) };
    }
    case "diameter": {
      const [c, q] = p as [V2, V2];
      if (!c || !q) return undefined;
      const q2 = sub(mul(c, 2), q);
      line(q2, q);
      arrow(q, sub(q, c));
      arrow(q2, sub(q2, c));
      return { segments: segs, label: add(mul(add(c, q), 0.5), mul(unit(perp(sub(q, c))), o * 0.3)) };
    }
    case "angle":
    case "sweep": {
      const [v, A, B] = p as [V2, V2, V2];
      if (!v || !A || !B) return undefined;
      const a0 = Math.atan2(A[1] - v[1], A[0] - v[0]);
      let a1 = Math.atan2(B[1] - v[1], B[0] - v[0]);
      while (a1 <= a0) a1 += Math.PI * 2;
      // An angle's arc sits inside its smaller legs; a sweep's just outside the arc.
      const r = d.kind === "angle" ? Math.max(o * 0.8, 0.45 * Math.min(len(sub(A, v)), len(sub(B, v)))) : len(sub(A, v)) + o * 0.6;
      const pts = arcPts(v, r, a0, a1);
      for (let i = 0; i + 1 < pts.length; i++) line(pts[i]!, pts[i + 1]!);
      const t0: V2 = [-Math.sin(a0), Math.cos(a0)], t1: V2 = [-Math.sin(a1), Math.cos(a1)];
      if (r * (a1 - a0) > k * 2.5) {
        arrow(pts[0]!, mul(t0, -1));
        arrow(pts[pts.length - 1]!, t1);
      }
      const am = (a0 + a1) / 2;
      return { segments: segs, label: add(v, [(r + o * 0.35) * Math.cos(am), (r + o * 0.35) * Math.sin(am)]) };
    }
  }
  return undefined;
}

/** Which stacking level each dx/dy dimension gets: per axis and side, shortest span innermost. */
function stackLevels(dims: SketchDimensionData[], centroid: V2): number[] {
  const groups = new Map<string, { i: number; span: number }[]>();
  dims.forEach((d, i) => {
    if (d.kind !== "dx" && d.kind !== "dy") return;
    const [a, b] = d.points as [V2, V2];
    if (!a || !b) return;
    const other = d.kind === "dx" ? 1 : 0;
    const side = (a[other]! + b[other]!) / 2 - centroid[other]! >= 0 ? 1 : -1;
    const key = `${d.kind}${side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ i, span: Math.abs(d.kind === "dx" ? b[0] - a[0] : b[1] - a[1]) });
  });
  const out: number[] = [];
  for (const g of groups.values()) g.sort((x, y) => x.span - y.span).forEach((e, lvl) => (out[e.i] = lvl));
  return out;
}

function shortFile(f: string) {
  return f.replace(/^.*\//, "");
}

function centroidOf(pts: V2[]): V2 {
  const n = pts.length || 1;
  return [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n];
}
