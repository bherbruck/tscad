/** The viewport's two-point distance measure: snapped points, a segment and a label. */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { fmtNum } from "./fmt";
import type { Viewport } from "./scene";

const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Measures between two picked points; {@link Viewport} adds `group` to its scene. */
export class MeasureTool {
  /** The points and the segment. */
  readonly group = new THREE.Group();
  #points: THREE.Vector3[] = [];
  #label?: HTMLElement;
  #vp: Viewport;

  constructor(viewport: Viewport) {
    this.#vp = viewport;
  }

  /** Snap a pick to the nearest edge vertex (within 12px) or use the surface point. */
  pointAt(clientX: number, clientY: number): THREE.Vector3 | undefined {
    const hit = this.#vp.hitTest(clientX, clientY);
    if (!hit) return undefined;
    const r = this.#vp.canvas.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    let best: THREE.Vector3 | undefined;
    let bestD = 12;
    for (const v of this.#vp.parts.values()) {
      if (!v.visible) continue;
      const pts = v.data.edgePoints;
      for (let e = 0; e < v.data.edgeCounts.length; e++) {
        const s = v.edgeStarts[e]!, n = v.data.edgeCounts[e]!;
        for (const i of [s, s + n - 1]) {
          tmpA.set(pts[3 * i]!, pts[3 * i + 1]!, pts[3 * i + 2]!).add(v.group.position);
          const p = tmpV.copy(tmpA).project(this.#vp.camera);
          const d = Math.hypot(((p.x + 1) / 2) * r.width - mx, ((1 - p.y) / 2) * r.height - my);
          if (d < bestD && tmpA.distanceTo(hit.point) < this.#vp.bounds.getSize(tmpB).length() * 0.2) {
            bestD = d;
            best = tmpA.clone();
          }
        }
      }
    }
    return best ?? hit.point;
  }

  /** Add a point; the second one completes a distance (and returns its ends). */
  add(p: THREE.Vector3): { a: THREE.Vector3; b: THREE.Vector3 } | undefined {
        if (this.#points.length >= 2) this.clear();
    this.#points.push(p.clone());
    const r = this.#vp.bounds.getSize(tmpV).length() * 0.006 + 0.05;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false }));
    dot.renderOrder = 40;
    dot.position.copy(p);
    this.group.add(dot);
    if (this.#points.length === 2) {
      const [a, b] = this.#points as [THREE.Vector3, THREE.Vector3];
      const g = new LineSegmentsGeometry();
      g.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      const mat = this.#vp.lineMaterial(0xffb020, 2.5);
      mat.depthTest = false;
      mat.dashed = false;
      const l = new LineSegments2(g, mat);
      l.renderOrder = 40;
      this.group.add(l);
      const label = document.createElement("div");
      label.className = "measure-label";
      const d = a.distanceTo(b);
      label.innerHTML = `<b>${fmtNum(d)} mm</b><span>Δx ${fmtNum(Math.abs(b.x - a.x))} · Δy ${fmtNum(Math.abs(b.y - a.y))} · Δz ${fmtNum(Math.abs(b.z - a.z))}</span>`;
      this.#vp.labelLayer.appendChild(label);
      this.#label = label;
      this.#vp.requestRender();
      return { a, b };
    }
    this.#vp.requestRender();
    return undefined;
  }

  /** Keep the distance label over the segment's midpoint (after each render). */
  updateLabel() {
        if (!this.#label || this.#points.length < 2) return;
    const mid = this.#points[0]!.clone().add(this.#points[1]!).multiplyScalar(0.5).project(this.#vp.camera);
    this.#label.style.transform = `translate(${((mid.x + 1) / 2) * this.#vp.size.x}px, ${((1 - mid.y) / 2) * this.#vp.size.y}px) translate(-50%, -130%)`;
  }

  /** Remove the points, segment and label. */
  clear() {
        for (const c of [...this.group.children]) {
      c.removeFromParent();
      if (c instanceof LineSegments2) {
        c.geometry.dispose();
        this.#vp.releaseLineMaterial(c.material);
      } else if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    this.#points = [];
    this.#label?.remove();
    this.#label = undefined;
    this.#vp.requestRender();
  }

  /** How many points are placed (0–2). */
  get count() {
    return this.#points.length;
  }
}
