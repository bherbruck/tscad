/** The plate preview: bed outlines (one per plate, side by side) under the arranged parts. */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { PlateData } from "./protocol";
import type { Viewport } from "./scene";

/** Gap between plates laid side by side, mm. */
export const PLATE_GAP = 40;

/** Print plate preview: the bed, and the parts laid out on it. */
export class PlateOverlay {
  #group = new THREE.Group();
  #mats: LineMaterial[] = [];
  #labels: HTMLElement[] = [];
  #shown = false;

  constructor(readonly viewport: Viewport) {
    viewport.scene.add(this.#group);
    viewport.afterRender.push(() => this.#placeLabels());
  }

  /** Plate `n`'s offset along X. */
  static offset(n: number, bed: [number, number]) {
    return n * (bed[0] + PLATE_GAP);
  }

  show(data: PlateData, partNames: string[]) {
    this.clear(false);
    this.#shown = true;
    const [bw, bd] = data.bed;
    for (let n = 0; n < data.plates; n++) {
      const x0 = PlateOverlay.offset(n, data.bed);
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), new THREE.MeshBasicMaterial({ color: 0x1b2333, transparent: true, opacity: 0.55, depthWrite: false }));
      sheet.position.set(x0 + bw / 2, bd / 2, -0.05);
      sheet.renderOrder = -1;
      this.#group.add(sheet);
      const g = new LineSegmentsGeometry();
      g.setPositions([x0, 0, 0, x0 + bw, 0, 0, x0 + bw, 0, 0, x0 + bw, bd, 0, x0 + bw, bd, 0, x0, bd, 0, x0, bd, 0, x0, 0, 0]);
      const m = this.viewport.lineMaterial(0x93b4ff, 1.6);
      this.#mats.push(m);
      this.#group.add(new LineSegments2(g, m));
      const el = document.createElement("div");
      el.className = "plate-label";
      el.textContent = `Plate ${n + 1}`;
      el.dataset.x = String(x0);
      el.dataset.y = String(bd);
      this.viewport.labelLayer.appendChild(el);
      this.#labels.push(el);
    }
    // Arrange the parts; parts that didn't make it (failed) are hidden meanwhile.
    const placed = new Set<string>();
    for (const it of data.items) {
      if (it.copy !== 1) continue;
      const t = it.transform.slice();
      t[3] = t[3]! + PlateOverlay.offset(it.plate, data.bed);
      this.viewport.setPartMatrix(it.name, t);
      placed.add(it.name);
    }
    for (const n of partNames) if (!placed.has(n)) this.viewport.setPartVisible(n, false);
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(PlateOverlay.offset(data.plates - 1, data.bed) + bw, bd, Math.max(10, ...data.items.map((i) => i.height))));
    this.viewport.setBoundsOverride(box);
  }

  #placeLabels() {
    const { x: w, y: h } = this.viewport.size;
    for (const el of this.#labels) {
      const p = new THREE.Vector3(Number(el.dataset.x), Number(el.dataset.y), 0).project(this.viewport.camera);
      el.style.display = p.z < 1 ? "" : "none";
      el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(0, -120%)`;
    }
  }

  get shown() {
    return this.#shown;
  }

  /** Remove the beds; `restore` puts the parts back as modelled. */
  clear(restore = true, partNames: string[] = []) {
    for (const c of [...this.#group.children]) {
      c.removeFromParent();
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      if (!(m.material as LineMaterial)?.isLineMaterial) (m.material as THREE.Material)?.dispose();
    }
    for (const m of this.#mats) this.viewport.releaseLineMaterial(m);
    this.#mats = [];
    for (const l of this.#labels) l.remove();
    this.#labels = [];
    if (restore && this.#shown) {
      for (const n of partNames) {
        this.viewport.setPartMatrix(n, undefined);
        this.viewport.setPartVisible(n, true);
      }
      this.viewport.setBoundsOverride(undefined);
      this.#shown = false;
    }
    this.viewport.requestRender();
  }
}
