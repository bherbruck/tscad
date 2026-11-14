/** Hover and selection highlights: a tinted copy of the face's triangles, or a thick edge line. */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { Hit, PartView, Viewport } from "./scene";

/** Draws the hovered and the selected face or edge over a {@link Viewport}'s parts. */
export class Highlighter {
  #vp: Viewport;
  #hoverKey = "";
  #hoverFace?: THREE.Mesh;
  #hoverEdge?: LineSegments2;
  #selFace?: THREE.Mesh;
  #selEdge?: LineSegments2;

  constructor(viewport: Viewport) {
    this.#vp = viewport;
  }

  /** Points of B-rep edge `index` of `part` as line segment pairs. */
  #edgeSegments(v: PartView, index: number): number[] {
    const out: number[] = [];
    const pts = v.data.edgePoints;
    for (let e = 0; e < v.data.edgeIds.length; e++) {
      if (v.data.edgeIds[e] !== index) continue;
      const start = v.edgeStarts[e]!, n = v.data.edgeCounts[e]!;
      for (let i = 0; i < n - 1; i++) {
        const a = 3 * (start + i);
        out.push(pts[a]!, pts[a + 1]!, pts[a + 2]!, pts[a + 3]!, pts[a + 4]!, pts[a + 5]!);
      }
    }
    return out;
  }

  #faceMesh(v: PartView, index: number, color: number, opacity: number): THREE.Mesh | undefined {
    const tris = v.faceTris.get(index);
    if (!tris) return undefined;
    const idx = new Uint32Array(tris.length * 3);
    tris.forEach((t, i) => {
      idx[3 * i] = v.data.indices[3 * t]!;
      idx[3 * i + 1] = v.data.indices[3 * t + 1]!;
      idx[3 * i + 2] = v.data.indices[3 * t + 2]!;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", v.mesh.geometry.getAttribute("position"));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
      clippingPlanes: this.#vp.clippingPlanes,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 20;
    return mesh;
  }

  #edgeLine(v: PartView, index: number, color: number, width: number): LineSegments2 | undefined {
    const segs = this.#edgeSegments(v, index);
    if (!segs.length) return undefined;
    const g = new LineSegmentsGeometry();
    g.setPositions(segs);
    const m = this.#vp.lineMaterial(color, width);
    m.depthTest = false;
    m.transparent = true;
    const l = new LineSegments2(g, m);
    l.renderOrder = 30;
    return l;
  }

  #disposeOverlay(o?: THREE.Mesh | LineSegments2) {
    if (!o) return;
    o.removeFromParent();
    if (o instanceof LineSegments2) {
      o.geometry.dispose();
      this.#vp.releaseLineMaterial(o.material);
    } else {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }

  /** Highlight what the pointer is over (or nothing). */
  setHover(hit: Hit | undefined) {
    const key = hit ? `${hit.kind}:${hit.part}:${hit.index}` : "";
    if (key === this.#hoverKey) return;
    this.#hoverKey = key;
    this.clearHover();
    this.#hoverKey = key;
    if (!hit) return;
    const v = this.#vp.parts.get(hit.part);
    if (!v) return;
    if (hit.kind === "face") {
      this.#hoverFace = this.#faceMesh(v, hit.index, 0x5b8cff, 0.28);
      if (this.#hoverFace) v.group.add(this.#hoverFace);
    } else {
      this.#hoverEdge = this.#edgeLine(v, hit.index, 0x7fa7ff, 3.5);
      if (this.#hoverEdge) v.group.add(this.#hoverEdge);
    }
    this.#vp.requestRender();
  }

  /** Remove the hover highlight. */
  clearHover() {
    this.#disposeOverlay(this.#hoverFace);
    this.#disposeOverlay(this.#hoverEdge);
    this.#hoverFace = this.#hoverEdge = undefined;
    this.#hoverKey = "";
    this.#vp.requestRender();
  }

  /** Highlight the selected face or edge (or nothing). */
  setSelection(hit: Hit | undefined) {
    this.clearSelection();
    if (!hit) return;
    const v = this.#vp.parts.get(hit.part);
    if (!v) return;
    if (hit.kind === "face") {
      this.#selFace = this.#faceMesh(v, hit.index, 0xffb020, 0.45);
      if (this.#selFace) v.group.add(this.#selFace);
    } else {
      this.#selEdge = this.#edgeLine(v, hit.index, 0xffb020, 4);
      if (this.#selEdge) v.group.add(this.#selEdge);
    }
    this.#vp.requestRender();
  }

  /** Remove the selection highlight. */
  clearSelection() {
    this.#disposeOverlay(this.#selFace);
    this.#disposeOverlay(this.#selEdge);
    this.#selFace = this.#selEdge = undefined;
    this.#vp.requestRender();
  }
}
