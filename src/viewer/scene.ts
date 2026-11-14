/**
 * The three.js viewport: Z-up CAD camera, infinite grid, PBR parts with crisp B-rep edges,
 * hover/pick of faces and edges, section plane with caps, x-ray, wireframe and measuring.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { MeshArrays } from "../kernel";
import { fmtNum } from "./fmt";
import { GroundGrid } from "./grid";
import { loadMouseScheme, mouseButtonsFor, TOUCH_MAP, type MouseScheme } from "./controls";
import { MeasureTool } from "./measure";
import { Highlighter } from "./highlight";
import { disposeNotes, noteGroup } from "./notes";
import type { DrawingNoteData } from "./protocol";

export { fmtNum };

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/** A standard camera view. */
export type ViewName = "iso" | "top" | "front" | "right" | "bottom" | "back" | "left";
/** The axis a section plane is normal to. */
export type SectionAxis = "x" | "y" | "z";

/** What the pointer is over: a face or an edge of a part. */
export interface Hit {
  kind: "face" | "edge";
  part: string;
  /** B-rep record index (for pickFace/pickEdge). */
  index: number;
  point: THREE.Vector3;
}

const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  iso: [1, -1.15, 0.9],
  top: [0, -1e-4, 1],
  bottom: [0, 1e-4, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

export const PALETTE = ["#7c9cff", "#f5a524", "#3ecf8e", "#f471b5", "#a78bfa", "#38bdf8", "#fb7185", "#facc15"];

/** A part in the viewport: its meshes, edges and the kernel data they came from. */
export interface PartView {
  name: string;
  color: THREE.Color;
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edges?: LineSegments2;
  wire?: THREE.LineSegments;
  caps: THREE.Object3D[];
  data: MeshArrays;
  /** face id → triangle indices */
  faceTris: Map<number, number[]>;
  /** edge polyline start offsets (in points) */
  edgeStarts: Uint32Array;
  visible: boolean;
  failed: boolean;
}

const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The three.js viewport. */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  readonly model = new THREE.Group();
  readonly overlay = new THREE.Group();
  readonly parts = new Map<string, PartView>();
  readonly canvas: HTMLCanvasElement;
  readonly labelLayer: HTMLElement;

  showEdges = true;
  wireframe = false;
  xray = false;
  section: { enabled: boolean; axis: SectionAxis; offset: number; flip: boolean } = { enabled: false, axis: "z", offset: 0.5, flip: false };

  /** Called when the camera or view changed (gizmo redraw etc). */
  onViewChange: () => void = () => {};

  #clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  #ground = new GroundGrid();
  #mouseScheme: MouseScheme = "cad";
  #key: THREE.DirectionalLight;
  #needsRender = true;
  #anim?: { from: CamState; to: CamState; start: number; dur: number };
  #lineMats: LineMaterial[] = [];
  #measure = new MeasureTool(this);
  #highlight = new Highlighter(this);
  #raycaster = new THREE.Raycaster();
  #size = new THREE.Vector2(1, 1);
  #bounds = new THREE.Box3(new THREE.Vector3(-20, -20, 0), new THREE.Vector3(20, 20, 20));
  #dark = true;
  #edgeColor = new THREE.Color("#0b0d12");
  #hasFitted = false;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "viewport-canvas";
    host.appendChild(this.canvas);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "viewport-labels";
    host.appendChild(this.labelLayer);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, stencil: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;

    this.#key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.#key.position.set(60, -80, 140);
    this.#key.castShadow = true;
    this.#key.shadow.mapSize.set(2048, 2048);
    this.#key.shadow.bias = -0.0004;
    this.#key.shadow.radius = 6;
    this.scene.add(this.#key, this.#key.target);
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.45);
    fill.position.set(-80, 60, 40);
    this.scene.add(fill);
    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x20242c, 0.35));

    this.persp = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.camera = this.persp;
    this.persp.position.set(120, -140, 100);

    this.controls = new OrbitControls(this.persp, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.setMouseScheme(loadMouseScheme());
    this.controls.touches = { ...TOUCH_MAP };
    // Right-drag orbits: no context menu on the canvas; middle-drag pans: no autoscroll.
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("mousedown", (e) => e.button === 1 && e.preventDefault());
    this.controls.addEventListener("change", () => {
      this.#needsRender = true;
      this.onViewChange();
    });
    this.controls.addEventListener("start", () => (this.#anim = undefined));

    this.scene.add(this.#ground.mesh, this.#ground.shadow);

    this.scene.add(this.model, this.overlay, this.#measure.group, this.#ground.labels);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.resize();
    this.#loop();
  }

  /** The camera's mouse scheme (see src/viewer/controls.ts). */
  get mouseScheme(): MouseScheme {
    return this.#mouseScheme;
  }

  /** Switch the camera's mouse scheme (not remembered: see saveMouseScheme). */
  setMouseScheme(scheme: MouseScheme) {
    this.#mouseScheme = scheme;
    this.controls.mouseButtons = mouseButtonsFor(scheme);
  }

  // ───────────────────────── rendering ─────────────────────────

  requestRender() {
    this.#needsRender = true;
  }

  resize() {
    const el = this.canvas.parentElement!;
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    this.#size.set(w, h);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.persp.aspect = w / h;
    this.#applyInsets();
    this.#updateOrthoFrustum();
    for (const m of this.#lineMats) m.resolution.set(w, h);
    this.#needsRender = true;
    this.onViewChange();
  }

  #loop = () => {
    requestAnimationFrame(this.#loop);
    if (this.#anim) this.#stepAnim();
    this.controls.update();
    if (!this.#needsRender) return;
    this.#needsRender = false;
    this.#ground.update(this.#bounds);
    this.#ground.updateLabels(this.camera, this.persp, this.ortho, this.#size.y);
    for (const f of this.beforeRender) f();
    this.renderer.render(this.scene, this.camera);
    this.#measure.updateLabel();
    for (const f of this.afterRender) f();
  };

  setTheme(dark: boolean) {
    this.#dark = dark;
    this.#edgeColor.set(dark ? "#07080c" : "#1d2330");
    for (const m of this.#lineMats) if (!m.userData.highlight) m.color.copy(this.#edgeColor);
    this.#ground.setTheme(dark);
    this.#needsRender = true;
  }

  // ───────────────────────── parts ─────────────────────────

  /** Replace the scene's parts. Parts listed in `keep` (failed this time) keep their last geometry. */
  setParts(parts: { name: string; color?: string; mesh?: MeshArrays; failed?: boolean }[]) {
    const seen = new Set<string>();
    parts.forEach((p, i) => {
      seen.add(p.name);
      const old = this.parts.get(p.name);
      if (!p.mesh) {
        if (old) {
          old.failed = !!p.failed;
          this.#applyPartStyle(old);
        }
        return;
      }
      const visible = old ? old.visible : true;
      if (old) this.#disposePart(old);
      const view = this.#buildPart(p.name, p.color ?? PALETTE[i % PALETTE.length]!, p.mesh);
      view.visible = visible;
      view.group.visible = visible;
      this.parts.set(p.name, view);
    });
    for (const [name, v] of this.parts) {
      if (!seen.has(name)) {
        this.#disposePart(v);
        this.parts.delete(name);
      }
    }
    this.clearHover();
    this.clearSelection();
    this.#refreshBounds();
    this.#rebuildCaps();
    if (!this.#hasFitted && (this.parts.size || this.drawings.size)) {
      this.#hasFitted = true;
      this.setView("iso", false);
    }
    this.#needsRender = true;
  }

  #buildPart(name: string, color: string, data: MeshArrays): PartView {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geom.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    const col = displayColor(color);
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      metalness: 0.08,
      roughness: 0.48,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      side: THREE.DoubleSide,
      shadowSide: THREE.FrontSide,
      clipShadows: true,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.userData.part = name;
    mesh.renderOrder = 10;
    const group = new THREE.Group();
    group.add(mesh);

    // Crisp B-rep edges.
    const segs = polylineSegments(data.edgePoints, data.edgeCounts);
    let edges: LineSegments2 | undefined;
    if (segs.length) {
      const lg = new LineSegmentsGeometry();
      lg.setPositions(segs);
      const lm = this.#lineMat(this.#edgeColor, 1.4);
      edges = new LineSegments2(lg, lm);
      edges.renderOrder = 11;
      edges.userData.part = name;
      group.add(edges);
    }

    const faceTris = new Map<number, number[]>();
    for (let t = 0; t < data.faceIds.length; t++) {
      const f = data.faceIds[t]!;
      let arr = faceTris.get(f);
      if (!arr) faceTris.set(f, (arr = []));
      arr.push(t);
    }
    const edgeStarts = new Uint32Array(data.edgeCounts.length);
    let acc = 0;
    for (let i = 0; i < data.edgeCounts.length; i++) {
      edgeStarts[i] = acc;
      acc += data.edgeCounts[i]!;
    }
    const view: PartView = { name, color: col, group, mesh, edges, caps: [], data, faceTris, edgeStarts, visible: true, failed: false };
    this.model.add(group);
    this.#applyPartStyle(view);
    return view;
  }

  /** A screen-space line material kept in sync with the viewport size (for overlays). */
  lineMaterial(color: THREE.ColorRepresentation, width: number): LineMaterial {
    return this.#lineMat(new THREE.Color(color), width, true);
  }

  /** Release a material from {@link lineMaterial}. */
  releaseLineMaterial(m: LineMaterial) {
    this.#dropLineMat(m);
  }

  /** Called after every rendered frame (overlay labels). */
  readonly afterRender: (() => void)[] = [];
  /** Called before every rendered frame (overlay fading). */
  readonly beforeRender: (() => void)[] = [];

  get size(): THREE.Vector2 {
    return this.#size;
  }

  #lineMat(color: THREE.Color, width: number, highlight = false) {
    const m = new LineMaterial({ color: color.getHex(), linewidth: width, worldUnits: false, alphaToCoverage: false });
    m.resolution.set(this.#size.x, this.#size.y);
    m.userData.highlight = highlight;
    this.#lineMats.push(m);
    return m;
  }

  #disposePart(v: PartView) {
    this.model.remove(v.group);
    v.mesh.geometry.dispose();
    v.mesh.material.dispose();
    if (v.edges) {
      v.edges.geometry.dispose();
      this.#dropLineMat(v.edges.material);
    }
    v.wire?.geometry.dispose();
    for (const c of v.caps) c.removeFromParent();
    v.caps = [];
  }

  #dropLineMat(m: LineMaterial) {
    m.dispose();
    this.#lineMats = this.#lineMats.filter((x) => x !== m);
  }

  #applyPartStyle(v: PartView) {
    const m = v.mesh.material;
    const planes = this.section.enabled ? [this.#clipPlane] : [];
    m.clippingPlanes = planes;
    m.transparent = this.xray || v.failed;
    m.opacity = this.xray ? 0.22 : v.failed ? 0.35 : 1;
    m.depthWrite = !this.xray && !v.failed;
    m.color.copy(v.failed ? new THREE.Color("#ff5d6c") : v.color);
    m.wireframe = false;
    m.needsUpdate = true;
    v.mesh.castShadow = !this.xray;
    if (v.edges) {
      v.edges.visible = this.showEdges;
      v.edges.material.clippingPlanes = planes;
      v.edges.material.needsUpdate = true;
    }
    if (this.wireframe && !v.wire) {
      const wg = new THREE.WireframeGeometry(v.mesh.geometry);
      v.wire = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: this.#dark ? 0x9fb0d0 : 0x3a4560, transparent: true, opacity: 0.35 }));
      v.wire.renderOrder = 12;
      v.group.add(v.wire);
    }
    if (v.wire) {
      v.wire.visible = this.wireframe;
      (v.wire.material as THREE.LineBasicMaterial).clippingPlanes = planes;
    }
  }

  restyle() {
    for (const v of this.parts.values()) this.#applyPartStyle(v);
    this.#rebuildCaps();
    this.#needsRender = true;
  }

  /**
   * Show a part placed by a full transform (plate preview: row-major 4×4), or back as modelled
   * (undefined). Picking is meant to be off while transforms are set.
   */
  setPartMatrix(name: string, m: number[] | undefined) {
    const v = this.parts.get(name);
    if (!v) return;
    if (!m) {
      v.group.matrixAutoUpdate = true;
      v.group.matrix.identity();
      v.group.position.set(0, 0, 0);
      v.group.quaternion.identity();
      v.group.scale.set(1, 1, 1);
    } else {
      v.group.matrixAutoUpdate = false;
      v.group.matrix.set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!, m[9]!, m[10]!, m[11]!, m[12] ?? 0, m[13] ?? 0, m[14] ?? 0, m[15] ?? 1);
    }
    v.group.matrixWorldNeedsUpdate = true;
    this.#needsRender = true;
  }

  /** Bounds to frame and size the grid by (the plate preview's beds). */
  setBoundsOverride(box: THREE.Box3 | undefined) {
    this.#boundsOverride = box?.clone();
    this.#refreshBounds();
    this.#needsRender = true;
  }

  #boundsOverride?: THREE.Box3;

  /** Move a part's display (explode view); picking and highlights follow. */
  setPartOffset(name: string, offset: THREE.Vector3) {
    const v = this.parts.get(name);
    if (!v || v.group.position.equals(offset)) return;
    v.group.position.copy(offset);
    this.#needsRender = true;
  }

  partOffset(name: string): THREE.Vector3 {
    return this.parts.get(name)?.group.position ?? new THREE.Vector3();
  }

  setPartVisible(name: string, visible: boolean) {
    const v = this.parts.get(name);
    if (!v) return;
    v.visible = visible;
    v.group.visible = visible;
    for (const c of v.caps) c.visible = visible;
    this.#needsRender = true;
  }

  setPartColor(name: string, color: string) {
    const v = this.parts.get(name);
    if (!v) return;
    v.color.copy(displayColor(color));
    this.#applyPartStyle(v);
    this.#rebuildCaps();
    this.#needsRender = true;
  }

  /** Flat `<drawing>` outlines, drawn as lines on z = 0. */
  readonly drawings = new Map<string, { line: LineSegments2; notes?: THREE.Group; box: THREE.Box3; visible: boolean; color: string }>();

  setDrawings(list: { name: string; color?: string; segments: Float32Array; notes?: DrawingNoteData[] }[]) {
    const old = this.drawings;
    for (const d of old.values()) {
      d.line.removeFromParent();
      d.line.geometry.dispose();
      this.#dropLineMat(d.line.material);
      if (d.notes) disposeNotes(d.notes);
    }
    const visible = new Map([...old].map(([k, v]) => [k, v.visible]));
    old.clear();
    list.forEach((d, i) => {
      if (!d.segments.length && !d.notes?.length) return;
      const g = new LineSegmentsGeometry();
      g.setPositions(d.segments);
      const color = d.color ?? ["#ffb020", "#3ecf8e", "#f471b5", "#38bdf8"][i % 4]!;
      const line = new LineSegments2(g, this.#lineMat(new THREE.Color(color), 2.2, true));
      line.renderOrder = 15;
      line.userData.drawing = d.name;
      const box = new THREE.Box3();
      if (d.segments.length) box.setFromBufferAttribute(new THREE.BufferAttribute(d.segments, 3));
      const vis = visible.get(d.name) ?? true;
      line.visible = vis;
      this.model.add(line);
      const notes = d.notes?.length ? noteGroup(d.notes, color) : undefined;
      if (notes) {
        notes.visible = vis;
        this.model.add(notes);
        box.union(new THREE.Box3().setFromObject(notes));
      }
      this.drawings.set(d.name, { line, notes, box, visible: vis, color });
    });
    this.#needsRender = true;
  }

  setDrawingVisible(name: string, visible: boolean) {
    const d = this.drawings.get(name);
    if (!d) return;
    d.visible = visible;
    d.line.visible = visible;
    if (d.notes) d.notes.visible = visible;
    this.#needsRender = true;
  }

  #refreshBounds() {
    const box = new THREE.Box3();
    for (const v of this.parts.values()) if (v.mesh.geometry.boundingBox) box.union(v.mesh.geometry.boundingBox);
    for (const d of this.drawings.values()) box.union(d.box);
    if (this.#boundsOverride) box.copy(this.#boundsOverride);
    if (!box.isEmpty()) this.#bounds.copy(box);
    // Keep the key light's shadow camera snug around the model.
    const s = this.#bounds.getBoundingSphere(new THREE.Sphere());
    const c = s.center;
    const r = Math.max(s.radius, 1);
    this.#key.position.set(c.x + r * 1.2, c.y - r * 1.6, c.z + r * 2.8);
    this.#key.target.position.copy(c);
    const sc = this.#key.shadow.camera;
    sc.left = sc.bottom = -r * 1.6;
    sc.right = sc.top = r * 1.6;
    sc.near = 0.1;
    sc.far = r * 8;
    sc.updateProjectionMatrix();
    this.#updateClipPlane();
  }

  get bounds(): THREE.Box3 {
    return this.#bounds;
  }

  // ───────────────────────── camera ─────────────────────────

  #visibleSphere(): THREE.Sphere {
    const box = new THREE.Box3();
    for (const v of this.parts.values()) if (v.visible && v.mesh.geometry.boundingBox) box.union(v.mesh.geometry.boundingBox);
    for (const d of this.drawings.values()) if (d.visible) box.union(d.box);
    if (this.#boundsOverride) box.copy(this.#boundsOverride);
    if (box.isEmpty()) box.copy(this.#bounds);
    return box.getBoundingSphere(new THREE.Sphere());
  }

  #state(): CamState {
    const c = this.camera;
    return { pos: c.position.clone(), target: this.controls.target.clone(), zoom: c.zoom, up: c.up.clone() };
  }

  #animateTo(to: CamState, animate = true) {
    if (!animate) {
      this.#apply(to);
      return;
    }
    this.#anim = { from: this.#state(), to, start: performance.now(), dur: 520 };
    this.#needsRender = true;
  }

  #apply(s: CamState) {
    this.camera.position.copy(s.pos);
    this.camera.zoom = s.zoom;
    this.camera.up.copy(s.up);
    this.controls.target.copy(s.target);
    if (this.camera === this.ortho) this.#updateOrthoFrustum();
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(s.target);
    this.#needsRender = true;
    this.onViewChange();
  }

  #stepAnim() {
    const a = this.#anim!;
    const t = Math.min(1, (performance.now() - a.start) / a.dur);
    const k = easeInOut(t);
    const target = a.from.target.clone().lerp(a.to.target, k);
    // Interpolate direction on the sphere and distance separately: smooth orbits, no dives.
    const d0 = a.from.pos.clone().sub(a.from.target), d1 = a.to.pos.clone().sub(a.to.target);
    const l0 = d0.length(), l1 = d1.length();
    const q = new THREE.Quaternion().setFromUnitVectors(d0.clone().normalize(), d1.clone().normalize());
    const qk = new THREE.Quaternion().slerp(q, k);
    const dir = d0.normalize().applyQuaternion(qk);
    const pos = target.clone().add(dir.multiplyScalar(l0 + (l1 - l0) * k));
    const zoom = a.from.zoom + (a.to.zoom - a.from.zoom) * k;
    this.#apply({ pos, target, zoom, up: a.from.up.clone().lerp(a.to.up, k).normalize() });
    if (t >= 1) this.#anim = undefined;
  }

  setView(name: ViewName, animate = true) {
    const s = this.#visibleSphere();
    const dir = new THREE.Vector3(...VIEW_DIRS[name]).normalize();
    const dist = this.#fitDistance(s.radius);
    const up = new THREE.Vector3(0, 0, 1);
    this.#animateTo({ pos: s.center.clone().add(dir.multiplyScalar(dist)), target: s.center.clone(), zoom: this.#fitZoom(s.radius, dist), up }, animate);
  }

  fit(animate = true) {
    const s = this.#visibleSphere();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = this.#fitDistance(s.radius);
    this.#animateTo({ pos: s.center.clone().add(dir.multiplyScalar(dist)), target: s.center.clone(), zoom: this.#fitZoom(s.radius, dist), up: this.camera.up.clone() }, animate);
  }

  #insets = { left: 0, right: 0 };

  /**
   * Screen space covered by floating panels (px). The view is shifted so the model centres in
   * the free region between them, and fits size it to that region.
   */
  setInsets(left: number, right: number) {
    if (left === this.#insets.left && right === this.#insets.right) return;
    this.#insets = { left, right };
    this.#applyInsets();
    this.#updateOrthoFrustum();
    this.#needsRender = true;
  }

  #applyInsets() {
    const { x: w, y: h } = this.#size;
    const free = w - this.#insets.left - this.#insets.right;
    // Ignore insets that leave too little room (narrow screens put panels in drawers).
    this.#useInsets = free > 240;
    const shift = this.#useInsets ? (this.#insets.left - this.#insets.right) / 2 : 0;
    if (shift) this.persp.setViewOffset(w, h, -shift, 0, w, h);
    else this.persp.clearViewOffset();
    this.persp.updateProjectionMatrix();
    this.#shift = shift;
  }

  #shift = 0;
  #useInsets = false;

  #fitDistance(r: number) {
    const fov = THREE.MathUtils.degToRad(this.persp.fov);
    const freeW = this.#size.x - (this.#useInsets ? this.#insets.left + this.#insets.right : 0);
    const aspect = Math.min(1, freeW / this.#size.y);
    return ((Math.max(r, 1) / Math.sin(fov / 2)) * 1.45) / Math.sqrt(aspect);
  }

  #fitZoom(r: number, dist: number) {
    if (this.camera !== this.ortho) return 1;
    // The ortho frustum is sized from distance (see #updateOrthoFrustum); zoom 1 matches persp.
    void r, dist;
    return 1;
  }

  #updateOrthoFrustum() {
    const dist = this.camera.position.distanceTo(this.controls?.target ?? new THREE.Vector3());
    const h = 2 * Math.max(dist, 1) * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2);
    const w = h * (this.#size.x / this.#size.y);
    this.ortho.left = -w / 2;
    this.ortho.right = w / 2;
    this.ortho.top = h / 2;
    this.ortho.bottom = -h / 2;
    if (this.#shift) this.ortho.setViewOffset(this.#size.x, this.#size.y, -this.#shift, 0, this.#size.x, this.#size.y);
    else this.ortho.clearViewOffset();
    this.ortho.updateProjectionMatrix();
  }

  get isOrtho() {
    return this.camera === this.ortho;
  }

  setOrtho(on: boolean) {
    if (on === this.isOrtho) return;
    const from = this.camera;
    const to = on ? this.ortho : this.persp;
    const target = this.controls.target;
    if (on) {
      to.position.copy(from.position);
      to.zoom = 1;
      this.camera = to;
      this.#updateOrthoFrustum();
    } else {
      // Keep the apparent size: move the perspective camera to the ortho's effective distance.
      const dir = from.position.clone().sub(target).normalize();
      const dist = from.position.distanceTo(target) / (from as THREE.OrthographicCamera).zoom;
      to.position.copy(target).add(dir.multiplyScalar(dist));
      this.camera = to;
    }
    to.up.copy(from.up);
    to.lookAt(target);
    to.updateProjectionMatrix();
    this.controls.object = to;
    this.controls.update();
    this.#needsRender = true;
    this.onViewChange();
  }

  /** Unit vectors of the world axes in screen space (for the gizmo): [x, y, depth]. */
  axesOnScreen(): Record<"x" | "y" | "z", [number, number, number]> {
    const m = this.camera.matrixWorldInverse;
    const f = (x: number, y: number, z: number): [number, number, number] => {
      const v = new THREE.Vector3(x, y, z).transformDirection(m);
      return [v.x, -v.y, v.z];
    };
    return { x: f(1, 0, 0), y: f(0, 1, 0), z: f(0, 0, 1) };
  }

  // ───────────────────────── section ─────────────────────────

  setSection(s: Partial<Viewport["section"]>) {
    Object.assign(this.section, s);
    this.#updateClipPlane();
    this.restyle();
  }

  #updateClipPlane() {
    const { axis, offset, flip } = this.section;
    const b = this.#bounds;
    const i = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const lo = b.min.getComponent(i), hi = b.max.getComponent(i);
    const at = lo + (hi - lo) * offset;
    const n = new THREE.Vector3();
    n.setComponent(i, flip ? 1 : -1);
    // Keep the half-space below `at` (or above when flipped).
    this.#clipPlane.set(n, flip ? -at : at);
    for (const v of this.parts.values()) for (const c of v.caps) if ((c as THREE.Mesh).isMesh && c.userData.cap) this.#placeCap(c as THREE.Mesh);
    this.#needsRender = true;
  }

  #placeCap(plane: THREE.Mesh) {
    const c = this.#bounds.getCenter(new THREE.Vector3());
    const size = this.#bounds.getSize(new THREE.Vector3()).length() * 1.5 + 1;
    this.#clipPlane.coplanarPoint(tmpV);
    const n = this.#clipPlane.normal;
    plane.scale.setScalar(size);
    const map = (plane.material as THREE.MeshBasicMaterial).map;
    if (map) map.repeat.set(size / 3, size / 3);
    // Project the bounds centre onto the plane.
    const p = c.clone().sub(n.clone().multiplyScalar(this.#clipPlane.distanceToPoint(c)));
    plane.position.copy(p);
    plane.lookAt(p.clone().sub(n));
  }

  #rebuildCaps() {
    let order = 1;
    for (const v of this.parts.values()) {
      for (const c of v.caps) c.removeFromParent();
      v.caps = [];
      if (!this.section.enabled || this.xray) continue;
      const geom = v.mesh.geometry;
      const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: [this.#clipPlane] };
      const back = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ ...base, side: THREE.BackSide, stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp }));
      const front = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ ...base, side: THREE.FrontSide, stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp }));
      back.renderOrder = front.renderOrder = order;
      const capColor = v.color.clone().offsetHSL(0, 0.08, -0.08);
      const capMat = new THREE.MeshBasicMaterial({
        color: capColor,
        map: hatchTexture().clone(),
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp,
        stencilZFail: THREE.ReplaceStencilOp,
        stencilZPass: THREE.ReplaceStencilOp,
        side: THREE.DoubleSide,
      });
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMat);
      cap.userData.cap = true;
      cap.renderOrder = order + 0.5;
      cap.onAfterRender = (r) => r.clearStencil();
      this.#placeCap(cap);
      back.visible = front.visible = cap.visible = v.visible;
      this.model.add(back, front, cap);
      v.caps.push(back, front, cap);
      order += 1;
    }
    this.#needsRender = true;
  }

  // ───────────────────────── picking ─────────────────────────

  #ndc(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** A raycaster through the given client point (for overlays' own picking). */
  raycasterAt(clientX: number, clientY: number): THREE.Raycaster {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.#ndc(clientX, clientY), this.camera);
    return rc;
  }

  /** What's under the cursor: an edge within a few px wins over the face behind it. */
  hitTest(clientX: number, clientY: number): Hit | undefined {
    const ndc = this.#ndc(clientX, clientY);
    this.#raycaster.setFromCamera(ndc, this.camera);
    const meshes = [...this.parts.values()].filter((v) => v.visible).map((v) => v.mesh);
    let faceHit: THREE.Intersection | undefined;
    for (const h of this.#raycaster.intersectObjects(meshes, false)) {
      if (this.section.enabled && this.#clipPlane.distanceToPoint(h.point) < 0) continue;
      faceHit = h;
      break;
    }
    const faceDist = faceHit ? faceHit.distance : Infinity;
    const edge = this.#nearestEdge(clientX, clientY, 7, faceDist);
    if (edge) return edge;
    if (faceHit && faceHit.faceIndex !== undefined && faceHit.faceIndex !== null) {
      const part = faceHit.object.userData.part as string;
      const v = this.parts.get(part)!;
      return { kind: "face", part, index: v.data.faceIds[faceHit.faceIndex]!, point: faceHit.point.clone() };
    }
    return undefined;
  }

  #nearestEdge(clientX: number, clientY: number, px: number, faceDist: number): Hit | undefined {
    if (!this.showEdges && !this.wireframe) return undefined;
    const r = this.canvas.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    const w = r.width, h = r.height;
    const camPos = this.camera.position;
    const slack = this.#bounds.getSize(tmpV).length() * 0.01 + 1e-3;
    let best: Hit | undefined;
    let bestD = px;
    const sa = new THREE.Vector2(), sb = new THREE.Vector2();
    for (const v of this.parts.values()) {
      if (!v.visible) continue;
      const pts = v.data.edgePoints;
      const counts = v.data.edgeCounts;
      for (let e = 0; e < counts.length; e++) {
        const start = v.edgeStarts[e]!;
        const n = counts[e]!;
        for (let i = 0; i < n - 1; i++) {
          const ia = 3 * (start + i), ib = ia + 3;
          tmpA.set(pts[ia]!, pts[ia + 1]!, pts[ia + 2]!).add(v.group.position);
          tmpB.set(pts[ib]!, pts[ib + 1]!, pts[ib + 2]!).add(v.group.position);
          if (this.section.enabled && this.#clipPlane.distanceToPoint(tmpA) < 0 && this.#clipPlane.distanceToPoint(tmpB) < 0) continue;
          const pa = tmpV.copy(tmpA).project(this.camera);
          if (pa.z > 1) continue;
          sa.set(((pa.x + 1) / 2) * w, ((1 - pa.y) / 2) * h);
          const pb = tmpV.copy(tmpB).project(this.camera);
          if (pb.z > 1) continue;
          sb.set(((pb.x + 1) / 2) * w, ((1 - pb.y) / 2) * h);
          const { d, t } = segDist(mx, my, sa, sb);
          if (d >= bestD) continue;
          const world = tmpA.clone().lerp(tmpB, t);
          // Hidden behind a face?
          if (world.distanceTo(camPos) > faceDist + slack && !this.xray) continue;
          bestD = d;
          best = { kind: "edge", part: v.name, index: v.data.edgeIds[e]!, point: world };
        }
      }
    }
    return best;
  }

  /** Highlight what the pointer is over (or nothing). */
  setHover(hit: Hit | undefined) {
    this.#highlight.setHover(hit);
  }

  /** Remove the hover highlight. */
  clearHover() {
    this.#highlight.clearHover();
  }

  /** Highlight the selected face or edge (or nothing). */
  setSelection(hit: Hit | undefined) {
    this.#highlight.setSelection(hit);
  }

  /** Remove the selection highlight. */
  clearSelection() {
    this.#highlight.clearSelection();
  }

  /** The section plane as a clipping-plane list for overlay materials (empty when off). */
  get clippingPlanes(): THREE.Plane[] {
    return this.section.enabled ? [this.#clipPlane] : [];
  }

  // ───────────────────────── measure ─────────────────────────

  /** Snap a pick to the nearest edge vertex (within 12px) or use the surface point. */
  measurePoint(clientX: number, clientY: number): THREE.Vector3 | undefined {
    return this.#measure.pointAt(clientX, clientY);
  }

  /** Add a measure point; the second one completes a distance (and returns its ends). */
  addMeasurePoint(p: THREE.Vector3): { a: THREE.Vector3; b: THREE.Vector3 } | undefined {
    return this.#measure.add(p);
  }

  /** Remove the measurement. */
  clearMeasure() {
    this.#measure.clear();
  }

  /** How many measure points are placed (0–2). */
  get measureCount() {
    return this.#measure.count;
  }

  /** A PNG of the current view. */
  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL("image/png");
  }
}

interface CamState {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
  up: THREE.Vector3;
}
let hatch: THREE.CanvasTexture | undefined;
/** Diagonal section hatching (multiplied with the part colour). */
function hatchTexture(): THREE.CanvasTexture {
  if (hatch) return hatch;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "#7a7a7a";
  ctx.lineWidth = 7;
  for (const o of [-64, 0, 64]) {
    ctx.beginPath();
    ctx.moveTo(o, 64);
    ctx.lineTo(o + 64, 0);
    ctx.stroke();
  }
  hatch = new THREE.CanvasTexture(c);
  hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping;
  hatch.colorSpace = THREE.SRGBColorSpace;
  hatch.anisotropy = 8;
  return hatch;
}

/** Very light colours wash out under lighting; keep them a touch below white so faces read. */
function displayColor(css: string): THREE.Color {
  const c = new THREE.Color(css);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.l > 0.78) c.setHSL(hsl.h, hsl.s, 0.78);
  return c;
}

function polylineSegments(points: Float32Array, counts: Uint32Array): number[] {
  const out: number[] = [];
  let o = 0;
  for (let e = 0; e < counts.length; e++) {
    const n = counts[e]!;
    for (let i = 0; i < n - 1; i++) {
      const a = 3 * (o + i);
      out.push(points[a]!, points[a + 1]!, points[a + 2]!, points[a + 3]!, points[a + 4]!, points[a + 5]!);
    }
    o += n;
  }
  return out;
}

function segDist(px: number, py: number, a: THREE.Vector2, b: THREE.Vector2): { d: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)), t };
}

