/**
 * Manufacturability heatmaps on the model: overhangs (yellow → red by how far past the limit),
 * thin walls (red under the minimum, fading to yellow at twice it), and part interference
 * (the shared volume drawn in red).
 */
import * as THREE from "three";
import type { InterferenceData, PrintabilityData } from "./protocol";
import type { Viewport } from "./scene";

export type CheckMode = "none" | "overhang" | "thin" | "interference";

const YELLOW = new THREE.Color("#ffd23f");
const ORANGE = new THREE.Color("#ff8c1a");
const RED = new THREE.Color("#ff2d55");

/** Severity 0..1 → yellow → orange → red. */
export function ramp(t: number, out = new THREE.Color()): THREE.Color {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? out.copy(YELLOW).lerp(ORANGE, x * 2) : out.copy(ORANGE).lerp(RED, (x - 0.5) * 2);
}

/** Thickness → severity: 1 at or under `minWall`, 0 at twice it and above. */
export function thinSeverity(thickness: number, minWall: number): number {
  if (!isFinite(thickness)) return 0;
  if (thickness <= minWall) return 1;
  return Math.max(0, 1 - (thickness - minWall) / minWall);
}

export class CheckOverlay {
  #objects: THREE.Object3D[] = [];
  #xrayBefore: boolean | undefined;

  constructor(readonly viewport: Viewport) {}

  clear() {
    for (const o of this.#objects) {
      o.removeFromParent();
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.#objects = [];
    if (this.#xrayBefore !== undefined) {
      this.viewport.xray = this.#xrayBefore;
      this.#xrayBefore = undefined;
      this.viewport.restyle();
    }
    this.viewport.requestRender();
  }

  /** Overhang or thin-wall heatmap from per-part printability results. */
  showPrintability(results: PrintabilityData[], mode: "overhang" | "thin", minWall: number) {
    this.clear();
    const c = new THREE.Color();
    for (const r of results) {
      const view = this.viewport.parts.get(r.name);
      if (!view) continue;
      const P = view.data.positions, I = view.data.indices;
      const pos: number[] = [], col: number[] = [];
      const nt = I.length / 3;
      for (let t = 0; t < nt; t++) {
        let sev: [number, number, number];
        if (mode === "overhang") {
          const s = r.severity[t] ?? 0;
          if (s <= 0) continue;
          sev = [s, s, s];
        } else {
          if (!r.thickness) continue;
          sev = [0, 1, 2].map((k) => thinSeverity(r.thickness![I[3 * t + k]!]!, minWall)) as [number, number, number];
          if (sev[0] <= 0 && sev[1] <= 0 && sev[2] <= 0) continue;
        }
        for (let k = 0; k < 3; k++) {
          const v = I[3 * t + k]! * 3;
          pos.push(P[v]!, P[v + 1]!, P[v + 2]!);
          ramp(mode === "overhang" ? 0.25 + 0.75 * sev[k]! : sev[k]!, c);
          col.push(c.r, c.g, c.b);
        }
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 19;
      view.group.add(mesh);
      this.#objects.push(mesh);
    }
    this.viewport.requestRender();
  }

  /** The shared volume of each interfering pair, in red, with the parts in x-ray. */
  showInterference(data: InterferenceData) {
    this.clear();
    for (const p of data.pairs) {
      if (!p.mesh) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(p.mesh.positions, 3));
      g.setIndex(new THREE.BufferAttribute(p.mesh.indices, 1));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.9, depthTest: false }));
      mesh.renderOrder = 45;
      // Follow the explode offset of the first part of the pair.
      mesh.position.copy(this.viewport.partOffset(p.a));
      this.viewport.scene.add(mesh);
      this.#objects.push(mesh);
    }
    if (data.pairs.length) {
      this.#xrayBefore = this.viewport.xray;
      this.viewport.xray = true;
      this.viewport.restyle();
    }
    this.viewport.requestRender();
  }
}
