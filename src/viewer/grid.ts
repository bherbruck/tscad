/** The viewport's ground: an infinite fading grid with red/green axes, mm labels and a shadow catcher. */
import * as THREE from "three";
import { fmtNum } from "./fmt";

const tmpV = new THREE.Vector3();

/** The ground grid, axis labels and shadow plane; {@link Viewport} adds them to its scene. */
export class GroundGrid {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Receives the key light's shadow under the model. */
  readonly shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  /** Axis label sprites. */
  readonly labels = new THREE.Group();
  #step = 10;
  #sprites: THREE.Sprite[] = [];
  #labelTex = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
  #bounds = new THREE.Box3();
  #dark = true;

  constructor() {
    this.mesh = this.#makeGrid();
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }));
    this.shadow.receiveShadow = true;
    this.shadow.renderOrder = -1;
  }

  /** Grid and label colours for a dark or light background. */
  setTheme(dark: boolean) {
    this.#dark = dark;
    const u = this.mesh.material.uniforms;
    u.uMinor!.value.set(dark ? "#2a3142" : "#cfd5e2");
    u.uMajor!.value.set(dark ? "#3d465c" : "#a9b2c6");
    this.shadow.material.opacity = dark ? 0.35 : 0.16;
    for (const t of this.#labelTex.values()) t.tex.dispose();
    this.#labelTex.clear();
  }

  #makeGrid() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uStep: { value: 10 },
        uMinor: { value: new THREE.Color("#2a3142") },
        uMajor: { value: new THREE.Color("#3d465c") },
        uCenter: { value: new THREE.Vector2() },
        uFade: { value: 400 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStep; uniform vec3 uMinor; uniform vec3 uMajor; uniform vec2 uCenter; uniform float uFade;
        varying vec3 vWorld;
        float line(vec2 p, float s, float w) {
          vec2 c = p / s;
          vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
          return 1.0 - min(min(g.x, g.y) / w, 1.0);
        }
        void main() {
          vec2 p = vWorld.xy;
          float minor = line(p, uStep / 10.0, 1.0);
          float major = line(p, uStep, 1.2);
          vec2 fw = fwidth(p);
          float ax = 1.0 - min(abs(p.y) / (fw.y * 1.6), 1.0);
          float ay = 1.0 - min(abs(p.x) / (fw.x * 1.6), 1.0);
          // Minor lines fade out when they get too dense.
          float density = clamp(1.0 - max(fw.x, fw.y) * 10.0 / uStep * 2.5, 0.0, 1.0);
          vec4 col = vec4(uMinor, minor * 0.55 * density);
          col = mix(col, vec4(uMajor, 0.9), major);
          col = mix(col, vec4(0.94, 0.33, 0.36, 0.95), ax);
          col = mix(col, vec4(0.36, 0.78, 0.42, 0.95), ay);
          float d = length(p - uCenter);
          col.a *= 1.0 - smoothstep(uFade * 0.35, uFade, d);
          if (col.a < 0.004) discard;
          gl_FragColor = col;
        }`,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    grid.renderOrder = -2;
    grid.frustumCulled = false;
    return grid;
  }

  /** Fit the grid, its fade and the shadow catcher to the model bounds. */
  update(bounds: THREE.Box3) {
    this.#bounds = bounds;
    const size = bounds.getSize(tmpV);
    const span = Math.max(size.x, size.y, size.z, 10);
    // Major step: 1/2/5 × 10^n so that ~4-10 majors cover the model.
    const raw = span / 4;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
    this.#step = step;
    const u = this.mesh.material.uniforms;
    u.uStep!.value = step;
    const extent = Math.max(span * 6, step * 20);
    this.mesh.scale.set(extent * 2, extent * 2, 1);
    const c = bounds.getCenter(tmpV);
    u.uCenter!.value.set(c.x, c.y);
    u.uFade!.value = extent;
    this.mesh.position.set(c.x, c.y, 0);
    this.shadow.position.set(c.x, c.y, bounds.min.z - 0.01);
    this.shadow.scale.set(span * 4, span * 4, 1);
  }

  /** Axis labels in mm along X and Y: depth-tested sprites, constant pixel size. */
  updateLabels(camera: THREE.Camera, persp: THREE.PerspectiveCamera, ortho: THREE.OrthographicCamera, heightPx: number) {
    const step = this.#step;
    const want: { text: string; pos: THREE.Vector3; axis: "x" | "y" }[] = [];
    const b = this.#bounds;
    const lo = Math.floor(Math.min(b.min.x, 0) / step) - 1, hi = Math.ceil(Math.max(b.max.x, 0) / step) + 1;
    for (let i = lo; i <= hi; i++) if (i !== 0) want.push({ text: fmtLen(i * step), pos: new THREE.Vector3(i * step, 0, 0), axis: "x" });
    const loY = Math.floor(Math.min(b.min.y, 0) / step) - 1, hiY = Math.ceil(Math.max(b.max.y, 0) / step) + 1;
    for (let i = loY; i <= hiY; i++) if (i !== 0) want.push({ text: fmtLen(i * step), pos: new THREE.Vector3(0, i * step, 0), axis: "y" });
    while (this.#sprites.length < want.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false }));
      sp.center.set(-0.08, 1.15);
      sp.renderOrder = 5;
      this.labels.add(sp);
      this.#sprites.push(sp);
    }
    // World size of one pixel at distance 1 (perspective) or anywhere (ortho).
    const px = camera === ortho ? (ortho.top - ortho.bottom) / ortho.zoom / heightPx : (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)) / heightPx;
    this.#sprites.forEach((sp, i) => {
      const it = want[i];
      sp.visible = !!it;
      if (!it) return;
      const t = this.#labelTexture(it.text, it.axis);
      if (sp.material.map !== t.tex) {
        sp.material.map = t.tex;
        sp.material.needsUpdate = true;
      }
      sp.position.copy(it.pos);
      const hpx = 15;
      sp.scale.set(hpx * t.aspect * px, hpx * px, 1);
    });
  }


  #labelTexture(text: string, axis: "x" | "y") {
    const key = `${axis}:${text}:${this.#dark}`;
    let t = this.#labelTex.get(key);
    if (t) return t;
    const scale = 3;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    const font = `500 ${11 * scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 2 * scale;
    c.width = w;
    c.height = 15 * scale;
    ctx.font = font;
    ctx.textBaseline = "middle";
    const base = axis === "x" ? [240, 84, 92] : [92, 200, 108];
    ctx.fillStyle = `rgba(${base.join(",")},${this.#dark ? 0.75 : 0.9})`;
    ctx.fillText(text, scale, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    t = { tex, aspect: c.width / c.height };
    this.#labelTex.set(key, t);
    return t;
  }

}

function fmtLen(v: number): string {
  return Math.abs(v) >= 1000 ? `${fmtNum(v / 1000)}m` : `${fmtNum(v)}`;
}
