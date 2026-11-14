/**
 * Assembly overlay: anchor triads, joint gizmos per mate type (revolute → ring about the axis,
 * slider → arrow, cylindrical → both, planar → square, ball → sphere), dragging a gizmo to drive
 * the param behind its mate, and an explode view.
 */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { AssemblyData, MateData, MateDrive } from "./protocol";
import type { Viewport } from "./scene";

const AMBER = 0xffb020;
const IDLE = 0x8b93a7;

/** An anchor frame: x, y, z axes and origin (from core's row-major 4×4, columns = axes). */
export interface Frame {
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
  o: THREE.Vector3;
}

export function frameOf(m: number[]): Frame {
  return {
    x: new THREE.Vector3(m[0], m[4], m[8]).normalize(),
    y: new THREE.Vector3(m[1], m[5], m[9]).normalize(),
    z: new THREE.Vector3(m[2], m[6], m[10]).normalize(),
    o: new THREE.Vector3(m[3], m[7], m[11]),
  };
}

/** Signed angle (degrees, right-hand about `axis`) from `a` to `b`, both projected square to it. */
export function signedAngle(a: THREE.Vector3, b: THREE.Vector3, axis: THREE.Vector3): number {
  const pa = a.clone().projectOnPlane(axis), pb = b.clone().projectOnPlane(axis);
  return THREE.MathUtils.radToDeg(Math.atan2(pa.clone().cross(pb).dot(axis), pa.dot(pb)));
}

/** Parameter `t` of the point on the line `o + t·dir` closest to `ray`. */
export function closestOnAxis(ray: THREE.Ray, o: THREE.Vector3, dir: THREE.Vector3): number {
  const w0 = o.clone().sub(ray.origin);
  const a = dir.dot(dir), b = dir.dot(ray.direction), c = ray.direction.dot(ray.direction);
  const d = dir.dot(w0), e = ray.direction.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return 0;
  return (b * e - c * d) / den;
}

interface Gizmo {
  mate: number;
  field: "angle" | "offset";
  object: THREE.Object3D;
  drive?: MateDrive;
  part: string;
}

export interface DragUpdate {
  param: string;
  /** New param value (unclamped; the host clamps and snaps). */
  value: number;
  mate: MateData;
  /** The mate value being shown while dragging (degrees or mm). */
  shown: number;
  field: "angle" | "offset";
}

export class AssemblyOverlay {
  readonly root = new THREE.Group();
  #triads?: LineSegments2;
  #triadMat?: LineMaterial;
  #gizmos: Gizmo[] = [];
  #data?: AssemblyData;
  #size = 50;
  #showAnchors = true;
  #explode = 0;
  #hover?: Gizmo;
  #drag?: { g: Gizmo; frame: Frame; start: THREE.Vector3 | number; startValue: number; startShown: number; last: number; total: number };
  /** Current param values, to start drags from. */
  values: Record<string, unknown> = {};
  onDrag: (u: DragUpdate) => void = () => {};
  onDragEnd: () => void = () => {};

  constructor(readonly viewport: Viewport) {
    this.root.renderOrder = 70;
    viewport.scene.add(this.root);
  }

  get present() {
    return !!this.#data && (this.#data.anchors.length > 0 || this.#data.mates.length > 0);
  }

  get dragging() {
    return !!this.#drag;
  }

  set(data: AssemblyData | undefined) {
    this.#data = data;
    this.#rebuild();
  }

  setShowAnchors(on: boolean) {
    this.#showAnchors = on;
    this.root.visible = on;
    this.viewport.requestRender();
  }

  get showAnchors() {
    return this.#showAnchors;
  }

  /** 0 = assembled; 1 = each part moved away from the assembly centre by its own distance. */
  setExplode(k: number) {
    this.#explode = k;
    this.#applyExplode();
    this.#rebuild();
  }

  get explode() {
    return this.#explode;
  }

  #partOffsets(): Map<string, THREE.Vector3> {
    const out = new Map<string, THREE.Vector3>();
    const vp = this.viewport;
    const centers: [string, THREE.Vector3][] = [];
    for (const [name, v] of vp.parts) {
      const box = v.mesh.geometry.boundingBox;
      if (box) centers.push([name, box.getCenter(new THREE.Vector3())]);
    }
    if (!centers.length) return out;
    const c = centers.reduce((acc, [, p]) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / centers.length);
    for (const [name, p] of centers) out.set(name, p.clone().sub(c).multiplyScalar(this.#explode * 1.2));
    return out;
  }

  #applyExplode() {
    const offs = this.#partOffsets();
    for (const name of this.viewport.parts.keys()) this.viewport.setPartOffset(name, offs.get(name) ?? new THREE.Vector3());
  }

  /** Re-apply after the parts change (new meshes start un-exploded). */
  refresh() {
    if (this.#explode) this.#applyExplode();
    this.#rebuild();
  }

  #rebuild() {
    for (const c of [...this.root.children]) {
      c.removeFromParent();
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        if (m.material && !(m.material as LineMaterial).isLineMaterial) (m.material as THREE.Material).dispose();
      });
    }
    if (this.#triadMat) this.viewport.releaseLineMaterial(this.#triadMat);
    this.#triadMat = undefined;
    this.#gizmos = [];
    const d = this.#data;
    if (!d) return this.viewport.requestRender();
    const size = this.viewport.bounds.getSize(new THREE.Vector3()).length() || 50;
    this.#size = size;
    const offs = this.#partOffsets();
    const off = (part: string) => offs.get(part) ?? new THREE.Vector3();

    // Anchor triads.
    const L = size * 0.05;
    const pos: number[] = [], col: number[] = [];
    const rgb = [new THREE.Color(0xf0545c), new THREE.Color(0x5cc86c), new THREE.Color(0x5b8cff)];
    for (const a of d.anchors) {
      const f = frameOf(a.frame);
      const o = f.o.clone().add(off(a.part));
      [f.x, f.y, f.z].forEach((ax, i) => {
        const e = o.clone().addScaledVector(ax, L);
        pos.push(o.x, o.y, o.z, e.x, e.y, e.z);
        const c = rgb[i]!;
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      });
    }
    if (pos.length) {
      const g = new LineSegmentsGeometry();
      g.setPositions(pos);
      g.setColors(col);
      const mat = this.viewport.lineMaterial(0xffffff, 2.2);
      mat.vertexColors = true;
      mat.depthTest = false;
      mat.transparent = true;
      this.#triadMat = mat;
      this.#triads = new LineSegments2(g, mat);
      this.#triads.renderOrder = 71;
      this.root.add(this.#triads);
    }

    // Joint gizmos at each mate's `a` anchor.
    d.mates.forEach((m, i) => {
      const anchor = d.anchors.find((x) => `${x.part}.${x.id}` === m.a);
      if (!anchor) return;
      const f = frameOf(anchor.frame);
      const bPart = m.b.split(".")[0]!;
      const holder = new THREE.Group();
      const basis = new THREE.Matrix4().makeBasis(f.x, f.y, f.z);
      holder.quaternion.setFromRotationMatrix(basis);
      holder.position.copy(f.o).add(off(anchor.part));
      this.root.add(holder);
      const R = size * 0.075;
      if (m.type === "revolute" || m.type === "cylindrical") {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.06, 10, 72), this.#mat(!!m.drive?.angle));
        ring.renderOrder = 72;
        // A knob on the ring at the joint's current angle shows which way it turns.
        const knob = new THREE.Mesh(new THREE.SphereGeometry(R * 0.14, 16, 12), ring.material);
        knob.position.set(R, 0, 0);
        knob.renderOrder = 72;
        ring.add(knob);
        holder.add(ring);
        this.#gizmos.push({ mate: i, field: "angle", object: ring, drive: m.drive?.angle, part: bPart });
      }
      if (m.type === "slider" || m.type === "cylindrical" || (m.type === "planar" && m.offset !== undefined)) {
        const arrow = new THREE.Group();
        const mat = this.#mat(!!m.drive?.offset);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.05, R * 0.05, R * 1.6, 12), mat);
        shaft.rotation.x = Math.PI / 2;
        shaft.position.z = R * 0.8;
        const head = new THREE.Mesh(new THREE.ConeGeometry(R * 0.16, R * 0.4, 20), mat);
        head.rotation.x = Math.PI / 2;
        head.position.z = R * 1.8;
        const tail = head.clone();
        tail.rotation.x = -Math.PI / 2;
        tail.position.z = -R * 0.2;
        for (const o of [shaft, head, tail]) o.renderOrder = 72;
        arrow.add(shaft, head, tail);
        holder.add(arrow);
        this.#gizmos.push({ mate: i, field: "offset", object: arrow, drive: m.drive?.offset, part: bPart });
      }
      if (m.type === "planar") {
        const sq = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.6, R * 1.6), this.#mat(false, 0.25));
        sq.renderOrder = 72;
        holder.add(sq);
      }
      if (m.type === "ball") {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(R * 0.5, 24, 16), this.#mat(false, 0.35));
        (ball.material as THREE.MeshBasicMaterial).wireframe = true;
        holder.add(ball);
      }
    });
    this.root.visible = this.#showAnchors;
    this.viewport.requestRender();
  }

  #mat(driven: boolean, opacity = 0.85) {
    return new THREE.MeshBasicMaterial({ color: driven ? AMBER : IDLE, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide });
  }

  #pick(clientX: number, clientY: number): Gizmo | undefined {
    if (!this.root.visible) return undefined;
    const rc = this.viewport.raycasterAt(clientX, clientY);
    const hits = rc.intersectObjects(this.#gizmos.map((g) => g.object), true);
    if (!hits.length) return undefined;
    let o: THREE.Object3D | null = hits[0]!.object;
    while (o) {
      const g = this.#gizmos.find((x) => x.object === o);
      if (g) return g;
      o = o.parent;
    }
    return undefined;
  }

  /** Hover feedback; returns whether the cursor is on a gizmo. */
  hover(clientX: number, clientY: number): Gizmo | undefined {
    if (this.#drag) return this.#drag.g;
    const g = this.#pick(clientX, clientY);
    if (g !== this.#hover) {
      this.#highlight(this.#hover, false);
      this.#highlight(g, true);
      this.#hover = g;
      this.viewport.requestRender();
    }
    return g;
  }

  #highlight(g: Gizmo | undefined, on: boolean) {
    if (!g) return;
    g.object.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m?.isMeshBasicMaterial) {
        m.opacity = on ? 1 : 0.85;
        m.color.set(on ? (g.drive ? 0xffd27a : 0xc5cad6) : g.drive ? AMBER : IDLE);
      }
    });
  }

  describe(g: Gizmo): string {
    const m = this.#data!.mates[g.mate]!;
    const v = m[g.field];
    const unit = g.field === "angle" ? "°" : " mm";
    const val = v === undefined ? "free" : `${+v.toFixed(2)}${unit}`;
    return g.drive ? `${m.type} ${m.b} · ${val} — drag to change ${g.drive.param}` : `${m.type} ${m.b} · ${val}${v === undefined ? "" : " (not bound to a param)"}`;
  }

  /** Start dragging the gizmo under the cursor. Returns false when there's nothing to drag. */
  beginDrag(clientX: number, clientY: number): Gizmo | undefined | false {
    const g = this.#pick(clientX, clientY);
    if (!g) return false;
    if (!g.drive) return g; // clicked, but nothing to drive
    const m = this.#data!.mates[g.mate]!;
    const anchor = this.#data!.anchors.find((x) => `${x.part}.${x.id}` === m.a)!;
    const frame = frameOf(anchor.frame);
    frame.o.add(this.#partOffsets().get(anchor.part) ?? new THREE.Vector3());
    const ray = this.viewport.raycasterAt(clientX, clientY).ray;
    const start = g.field === "angle" ? this.#onPlane(ray, frame) : closestOnAxis(ray, frame.o, frame.z);
    if (start === undefined) return g;
    const v = Number(this.values[g.drive.param] ?? 0);
    this.#drag = { g, frame, start, startValue: v, startShown: m[g.field] ?? 0, last: 0, total: 0 };
    return g;
  }

  #onPlane(ray: THREE.Ray, f: Frame): THREE.Vector3 | undefined {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.z, f.o);
    const p = ray.intersectPlane(plane, new THREE.Vector3());
    return p ? p.sub(f.o) : undefined;
  }

  drag(clientX: number, clientY: number) {
    const d = this.#drag;
    if (!d || !d.g.drive) return;
    const ray = this.viewport.raycasterAt(clientX, clientY).ray;
    let delta: number;
    if (d.g.field === "angle") {
      const cur = this.#onPlane(ray, d.frame);
      if (!cur) return;
      // Unwrap so a drag can go past ±180°.
      const a = signedAngle(d.start as THREE.Vector3, cur, d.frame.z);
      let step = a - d.last;
      if (step > 180) step -= 360;
      if (step < -180) step += 360;
      d.total += step;
      d.last = a;
      delta = d.total;
    } else delta = closestOnAxis(ray, d.frame.o, d.frame.z) - (d.start as number);
    const m = this.#data!.mates[d.g.mate]!;
    this.onDrag({ param: d.g.drive.param, value: d.startValue + delta / d.g.drive.scale, mate: m, shown: d.startShown + delta, field: d.g.field });
  }

  endDrag() {
    if (!this.#drag) return;
    this.#drag = undefined;
    this.onDragEnd();
  }
}
