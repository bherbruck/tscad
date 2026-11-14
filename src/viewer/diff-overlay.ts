/** Draws a geometry diff: material added in green, removed in red, the parts in x-ray. */
import * as THREE from "three";
import type { MeshArrays } from "../kernel";
import type { DiffData } from "./protocol";
import type { Viewport } from "./scene";

const ADDED = new THREE.Color("#3ecf8e");
const REMOVED = new THREE.Color("#ff4d6d");

/** Geometry diff: added material green, removed material red, against a pinned version. */
export class DiffOverlay {
  #objects: THREE.Object3D[] = [];
  #xrayBefore: boolean | undefined;

  constructor(readonly viewport: Viewport) {}

  show(data: DiffData) {
    this.clear(false);
    for (const m of data.meshes) {
      const offset = this.viewport.partOffset(m.part);
      if (m.added) this.#add(m.added, ADDED, 0.9, offset);
      if (m.removed) this.#add(m.removed, REMOVED, 0.55, offset);
    }
    // Added material sits inside the new part: see through the parts while diffing.
    if (this.#xrayBefore === undefined) {
      this.#xrayBefore = this.viewport.xray;
      this.viewport.xray = true;
      this.viewport.restyle();
    }
    this.viewport.requestRender();
  }

  #add(m: MeshArrays, color: THREE.Color, opacity: number, offset: THREE.Vector3) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6, transparent: opacity < 1, opacity, depthWrite: opacity >= 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.copy(offset);
    mesh.renderOrder = 25;
    this.viewport.scene.add(mesh);
    this.#objects.push(mesh);
  }

  /** Remove the diff solids (and leave x-ray as the user had it when `restore`). */
  clear(restore = true) {
    for (const o of this.#objects) {
      o.removeFromParent();
      const m = o as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.#objects = [];
    if (restore && this.#xrayBefore !== undefined) {
      this.viewport.xray = this.#xrayBefore;
      this.#xrayBefore = undefined;
      this.viewport.restyle();
    }
    this.viewport.requestRender();
  }
}
