/**
 * Headless renderer: kernel meshes → a product-style PNG, in pure TypeScript (no GPU, no DOM).
 *
 * A small deferred software rasterizer: supersampled z-buffer with perspective-correct normals,
 * studio lighting (key, fill, rim, hemisphere ambient, soft specular), a filmic tone curve, a
 * soft contact shadow on an invisible ground plane, silhouette outlines and the B-rep's own edge
 * lines (depth-tested). Runs the same in bun and in the browser.
 *
 * @example
 * const png = renderPNG([{ name: "plate", color: "#4f7cac", mesh: await kernel.meshAt("plate", 0.02) }])
 * await Bun.write("plate.png", png)
 */
import type { MeshArrays } from "../kernel";
import { parseColor, srgbToLinear } from "../export/color";
import { encodePNG } from "./png";


/** One part to draw. Same shape as the exporters' `ExportPart`; only positions/normals/indices/edges are read. */
export type RenderPart = {
  name: string;
  color?: string;
  mesh: Pick<MeshArrays, "positions" | "normals" | "indices"> & Partial<Pick<MeshArrays, "edgePoints" | "edgeCounts">>;
};

export type View = "iso" | "front" | "back" | "top" | "bottom" | "right" | "left" | { azimuth: number; elevation: number };

export interface RenderOptions {
  /** Output width in pixels. Default 1200. */
  width?: number;
  /** Output height in pixels. Default 800. */
  height?: number;
  /** Camera direction. Default `"iso"` (front-right, from above). Angles in degrees; azimuth 0 = from +X, -90 = from -Y (front). */
  view?: View;
  /** `"dark"` (default, matches the viewer), `"light"`, `"transparent"`, or any CSS colour. */
  background?: "dark" | "light" | "transparent" | (string & {});
  /** Draw the B-rep edges and silhouettes. Default true. */
  edges?: boolean;
  /**
   * Also draw smooth edges (seams and the tangent boundaries of fillets), which a product
   * render usually hides. Default false.
   */
  smoothEdges?: boolean;
  /** Soft ground shadow. Default true. */
  shadow?: boolean;
  /** Supersampling factor per axis (1–4). Default 2. */
  ssaa?: number;
  /** `"perspective"` (default, a gentle 20° lens) or `"orthographic"`. */
  projection?: "perspective" | "orthographic";
  /** Fraction of the image left as margin on each side. Default 0.07. */
  margin?: number;
}

/** Raw RGBA pixels, row-major from the top-left. */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const add = (...vs: [number, V3][]): V3 => {
  const o: V3 = [0, 0, 0];
  for (const [k, v] of vs) (o[0] += k * v[0]), (o[1] += k * v[1]), (o[2] += k * v[2]);
  return o;
};

const VIEWS: Record<Exclude<View, object>, [number, number]> = {
  iso: [-58, 28],
  front: [-90, 0],
  back: [90, 0],
  right: [0, 0],
  left: [180, 0],
  top: [-90, 90],
  bottom: [-90, -90],
};

interface Theme {
  /** Background at the centre and at the corners (linear-ish sRGB 0..1). */
  bg: [V3, V3] | null;
  edge: V3;
  edgeAlpha: number;
  shadow: number;
  sky: V3;
  ground: V3;
  /** Brightness of the light pool on the floor under the model. */
  floor: number;
}

const hex = (s: string): V3 => {
  const c = parseColor(s) ?? [0, 0, 0, 255];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
};

function theme(bg: RenderOptions["background"]): Theme {
  if (bg === undefined || bg === "dark")
    return { bg: [hex("#161c2b"), hex("#07080c")], edge: hex("#06070a"), edgeAlpha: 0.9, shadow: 0.8, sky: [0.8, 0.86, 1], ground: [0.13, 0.14, 0.17], floor: 0.07 };
  if (bg === "light")
    return { bg: [hex("#ffffff"), hex("#dfe3ea")], edge: hex("#1d2330"), edgeAlpha: 0.85, shadow: 0.45, sky: [1, 1, 1], ground: [0.42, 0.42, 0.45], floor: 0 };
  if (bg === "transparent") return { bg: null, edge: hex("#0b0d12"), edgeAlpha: 0.9, shadow: 0, sky: [0.9, 0.93, 1], ground: [0.25, 0.26, 0.3], floor: 0 };
  const c = hex(bg);
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return lum > 0.5
    ? { bg: [c, c], edge: hex("#1d2330"), edgeAlpha: 0.85, shadow: 0.3, sky: [1, 1, 1], ground: [0.42, 0.42, 0.45], floor: 0 }
    : { bg: [c, c], edge: hex("#06070a"), edgeAlpha: 0.9, shadow: 0.7, sky: [0.8, 0.86, 1], ground: [0.13, 0.14, 0.17], floor: 0.05 };
}

const DEFAULT_PART: V3 = hex("#9aa8bc");
/** Overall brightness of lit surfaces before the tone curve. */
const EXPOSURE = 0.8;

/** Render `parts` to raw RGBA pixels. */
export function renderImage(parts: RenderPart[], opts: RenderOptions = {}): Image {
  const W = Math.max(1, Math.round(opts.width ?? 1200));
  const H = Math.max(1, Math.round(opts.height ?? 800));
  const ss = Math.max(1, Math.min(4, Math.round(opts.ssaa ?? 2)));
  const SW = W * ss, SH = H * ss;
  const th = theme(opts.background);
  const drawEdges = opts.edges ?? true;
  const ortho = opts.projection === "orthographic";
  const margin = opts.margin ?? 0.07;

  // ---- scene bounds
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const pos = p.mesh.positions;
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = pos[i + k]!;
        if (v < lo[k]!) lo[k] = v;
        if (v > hi[k]!) hi[k] = v;
      }
  }
  const empty = !Number.isFinite(lo[0]);
  if (empty) lo.fill(-1), hi.fill(1);
  const centre: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.max(1e-6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);

  // ---- camera
  const [azDeg, elDeg] = typeof opts.view === "object" ? [opts.view.azimuth, opts.view.elevation] : VIEWS[opts.view ?? "iso"];
  const az = (azDeg * Math.PI) / 180, el = (Math.max(-90, Math.min(90, elDeg)) * Math.PI) / 180;
  const toCam: V3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const fwd: V3 = [-toCam[0], -toCam[1], -toCam[2]];
  let right: V3 = cross(fwd, [0, 0, 1]);
  if (Math.hypot(...right) < 1e-6) right = [-Math.sin(az), Math.cos(az), 0]; // straight up/down: keep the azimuth's sense
  right = norm(right);
  const up = norm(cross(right, fwd));
  const fov = (20 * Math.PI) / 180;
  const dist = ortho ? radius * 4 : radius / Math.sin(fov / 2);
  const eye: V3 = add([1, centre], [dist, toCam]);

  // camera-space projection (before the 2D fit): sx = x/z (perspective) or x (ortho)
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    const px = x - eye[0], py = y - eye[1], pz = z - eye[2];
    const cx = px * right[0] + py * right[1] + pz * right[2];
    const cy = px * up[0] + py * up[1] + pz * up[2];
    const cz = px * fwd[0] + py * fwd[1] + pz * fwd[2];
    return ortho ? [cx, cy, cz] : [cx / cz, cy / cz, cz];
  };

  // fit the projected model into the frame
  let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
  for (const p of parts) {
    const pos = p.mesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y] = proj(pos[i]!, pos[i + 1]!, pos[i + 2]!);
      if (x < sx0) sx0 = x;
      if (x > sx1) sx1 = x;
      if (y < sy0) sy0 = y;
      if (y > sy1) sy1 = y;
    }
  }
  if (empty) (sx0 = -1), (sx1 = 1), (sy0 = -1), (sy1 = 1);
  const scale = Math.min((SW * (1 - 2 * margin)) / Math.max(1e-9, sx1 - sx0), (SH * (1 - 2 * margin)) / Math.max(1e-9, sy1 - sy0));
  const ox = SW / 2 - ((sx0 + sx1) / 2) * scale;
  const oy = SH / 2 + ((sy0 + sy1) / 2) * scale;
  /** World → supersampled screen [X, Y, depth z]. */
  const toScreen = (x: number, y: number, z: number): [number, number, number] => {
    const [a, b, c] = proj(x, y, z);
    return [ox + a * scale, oy - b * scale, c];
  };
  /** Screen → world ray direction (unnormalised) and origin. */
  const ray = (X: number, Y: number): [V3, V3] => {
    const a = (X - ox) / scale, b = (oy - Y) / scale;
    if (ortho) return [add([1, eye], [a, right], [b, up]), fwd];
    return [eye, add([1, fwd], [a, right], [b, up])];
  };

  // ---- G-buffer
  const N = SW * SH;
  const depth = new Float32Array(N).fill(Infinity); // camera z (distance along fwd)
  const nrm = new Float32Array(N * 3);
  const pid = new Int16Array(N).fill(-1);

  parts.forEach((part, pi) => {
    const { positions: pos, normals: nor, indices: idx } = part.mesh;
    const nv = pos.length / 3;
    const X = new Float32Array(nv), Y = new Float32Array(nv), Z = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      const s = toScreen(pos[3 * v]!, pos[3 * v + 1]!, pos[3 * v + 2]!);
      X[v] = s[0];
      Y[v] = s[1];
      Z[v] = s[2];
    }
    const hasN = nor.length === pos.length;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
      const ax = X[a]!, ay = Y[a]!, bx = X[b]!, by = Y[b]!, cx = X[c]!, cy = Y[c]!;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      // CCW from outside in world becomes CW on screen (Y down): cull the rest.
      if (area >= 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(SW - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(SH - 1, Math.ceil(Math.max(ay, by, cy)));
      if (minX > maxX || minY > maxY) continue;
      const iza = 1 / Z[a]!, izb = 1 / Z[b]!, izc = 1 / Z[c]!;
      // face normal fallback
      let fn: V3 | undefined;
      if (!hasN) {
        const p = (i: number): V3 => [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!];
        const pa = p(a), pb = p(b), pc = p(c);
        fn = norm(cross(add([1, pb], [-1, pa]), add([1, pc], [-1, pa])));
      }
      const inv = 1 / area;
      for (let py = minY; py <= maxY; py++) {
        const yc = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const xc = px + 0.5;
          const w0 = ((bx - xc) * (cy - yc) - (by - yc) * (cx - xc)) * inv;
          const w1 = ((cx - xc) * (ay - yc) - (cy - yc) * (ax - xc)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          let z: number, p0 = w0, p1 = w1, p2 = w2;
          if (ortho) z = w0 * Z[a]! + w1 * Z[b]! + w2 * Z[c]!;
          else {
            const iz = w0 * iza + w1 * izb + w2 * izc;
            z = 1 / iz;
            p0 = w0 * iza * z;
            p1 = w1 * izb * z;
            p2 = w2 * izc * z;
          }
          const o = py * SW + px;
          if (z >= depth[o]!) continue;
          depth[o] = z;
          pid[o] = pi;
          if (hasN) {
            nrm[3 * o] = p0 * nor[3 * a]! + p1 * nor[3 * b]! + p2 * nor[3 * c]!;
            nrm[3 * o + 1] = p0 * nor[3 * a + 1]! + p1 * nor[3 * b + 1]! + p2 * nor[3 * c + 1]!;
            nrm[3 * o + 2] = p0 * nor[3 * a + 2]! + p1 * nor[3 * b + 2]! + p2 * nor[3 * c + 2]!;
          } else {
            nrm[3 * o] = fn![0];
            nrm[3 * o + 1] = fn![1];
            nrm[3 * o + 2] = fn![2];
          }
        }
      }
    }
  });

  // ---- contact shadow: everything dropped straight onto the ground plane, blurred
  const groundZ = lo[2];
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-6);
  const pad = ext * 0.35;
  const gx0 = lo[0] - pad, gy0 = lo[1] - pad;
  const gw = hi[0] - lo[0] + 2 * pad, gh = hi[1] - lo[1] + 2 * pad;
  const GR = 320;
  const gScale = GR / Math.max(gw, gh);
  const GW = Math.max(8, Math.ceil(gw * gScale)), GH = Math.max(8, Math.ceil(gh * gScale));
  let shadowMap: Float32Array | undefined;
  if ((opts.shadow ?? true) && th.shadow > 0 && !empty) {
    const hard = new Float32Array(GW * GH);
    const height = Math.max(1e-6, hi[2] - lo[2]);
    for (const p of parts) {
      const { positions: pos, indices: idx } = p.mesh;
      for (let t = 0; t < idx.length; t += 3) {
        const v = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        const xs = v.map((i) => (pos[3 * i]! - gx0) * gScale), ys = v.map((i) => (pos[3 * i + 1]! - gy0) * gScale);
        // nearer the ground → darker (contact), fading with height
        const zmin = Math.min(...v.map((i) => pos[3 * i + 2]!)) - groundZ;
        const strength = 0.45 + 0.55 * Math.exp(-(zmin / height) * 3);
        const area = (xs[1]! - xs[0]!) * (ys[2]! - ys[0]!) - (ys[1]! - ys[0]!) * (xs[2]! - xs[0]!);
        if (Math.abs(area) < 1e-12) continue;
        const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(GW - 1, Math.ceil(Math.max(...xs)));
        const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(GH - 1, Math.ceil(Math.max(...ys)));
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const xc = x + 0.5, yc = y + 0.5;
            const w0 = ((xs[1]! - xc) * (ys[2]! - yc) - (ys[1]! - yc) * (xs[2]! - xc)) / area;
            const w1 = ((xs[2]! - xc) * (ys[0]! - yc) - (ys[2]! - yc) * (xs[0]! - xc)) / area;
            if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
            const o = y * GW + x;
            if (strength > hard[o]!) hard[o] = strength;
          }
      }
    }
    shadowMap = blur(hard, GW, GH, Math.max(2, Math.round(GR * 0.03)), 3);
    const wide = blur(hard, GW, GH, Math.max(3, Math.round(GR * 0.09)), 3);
    for (let i = 0; i < shadowMap.length; i++) shadowMap[i] = Math.min(1, 0.6 * shadowMap[i]! + 0.55 * wide[i]!);
  }
  const shadowAt = (wx: number, wy: number): number => {
    if (!shadowMap) return 0;
    const fx = (wx - gx0) * gScale - 0.5, fy = (wy - gy0) * gScale - 0.5;
    const x = Math.floor(fx), y = Math.floor(fy);
    if (x < 0 || y < 0 || x >= GW - 1 || y >= GH - 1) return 0;
    const tx = fx - x, ty = fy - y;
    const s = shadowMap;
    return (
      (s[y * GW + x]! * (1 - tx) + s[y * GW + x + 1]! * tx) * (1 - ty) +
      (s[(y + 1) * GW + x]! * (1 - tx) + s[(y + 1) * GW + x + 1]! * tx) * ty
    );
  };

  // ---- lights (relative to the camera, so every view is lit like a studio shot)
  const Z: V3 = [0, 0, 1];
  const key = norm(add([-0.55, right], [0.55, toCam], [0.85, Z]));
  const fill = norm(add([0.9, right], [0.45, toCam], [0.05, Z]));
  const rim = norm(add([0.35, right], [-1, toCam], [0.6, Z]));
  const half = norm(add([1, key], [1, toCam]));
  const albedo = parts.map((p) => {
    const c = parseColor(p.color);
    const s: V3 = c ? [c[0] / 255, c[1] / 255, c[2] / 255] : DEFAULT_PART;
    return [srgbToLinear(s[0] * 255), srgbToLinear(s[1] * 255), srgbToLinear(s[2] * 255)] as V3;
  });

  // ---- shade (into sRGB floats + alpha)
  const col = new Float32Array(N * 4);
  const bgCentre = th.bg?.[0], bgEdge = th.bg?.[1];
  for (let py = 0; py < SH; py++) {
    for (let px = 0; px < SW; px++) {
      const o = py * SW + px;
      const p = pid[o]!;
      if (p < 0) {
        // background: soft radial gradient + ground shadow
        if (!bgCentre || !bgEdge) {
          // transparent: shadow only
          let a = 0;
          if (shadowMap) {
            const [ro, rd] = ray(px + 0.5, py + 0.5);
            if (Math.abs(rd[2]) > 1e-9) {
              const t = (groundZ - ro[2]) / rd[2];
              if (t > 0) a = 0.5 * shadowAt(ro[0] + t * rd[0], ro[1] + t * rd[1]);
            }
          }
          col.set([0, 0, 0, a], 4 * o);
          continue;
        }
        const u = px / SW - 0.5, v = py / SH - 0.42;
        const r = Math.min(1, Math.hypot(u * 1.1, v * 1.25) * 1.45);
        const k = r * r * (3 - 2 * r);
        let c0 = bgCentre[0] + (bgEdge[0] - bgCentre[0]) * k;
        let c1 = bgCentre[1] + (bgEdge[1] - bgCentre[1]) * k;
        let c2 = bgCentre[2] + (bgEdge[2] - bgCentre[2]) * k;
        if (shadowMap) {
          const [ro, rd] = ray(px + 0.5, py + 0.5);
          if (Math.abs(rd[2]) > 1e-9) {
            const t = (groundZ - ro[2]) / rd[2];
            if (t > 0) {
              const gx = ro[0] + t * rd[0], gy = ro[1] + t * rd[1];
              // a soft pool of light on the floor under the model, so the shadow has something to darken
              const dd = Math.hypot(gx - centre[0], gy - centre[1]) / (ext * 0.9);
              const glow = th.floor * Math.exp(-dd * dd);
              c0 += glow;
              c1 += glow;
              c2 += glow * 1.08;
              const s = 1 - th.shadow * shadowAt(gx, gy);
              c0 *= s;
              c1 *= s;
              c2 *= s;
            }
          }
        }
        col[4 * o] = c0;
        col[4 * o + 1] = c1;
        col[4 * o + 2] = c2;
        col[4 * o + 3] = 1;
        continue;
      }
      let n: V3 = norm([nrm[3 * o]!, nrm[3 * o + 1]!, nrm[3 * o + 2]!]);
      if (dot(n, toCam) < 0) n = [-n[0], -n[1], -n[2]];
      const a = albedo[p]!;
      const ndk = Math.max(0, dot(n, key)), ndf = Math.max(0, dot(n, fill));
      const ndv = Math.max(0, dot(n, toCam));
      const hemi = 0.5 + 0.5 * n[2];
      const amb: V3 = [
        th.ground[0] + (th.sky[0] - th.ground[0]) * hemi,
        th.ground[1] + (th.sky[1] - th.ground[1]) * hemi,
        th.ground[2] + (th.sky[2] - th.ground[2]) * hemi,
      ];
      // soft wrap on the key keeps the shadow side from going dead
      const keyD = Math.max(0, (dot(n, key) + 0.15) / 1.15) * 0.25 + ndk * 0.95;
      const fres = 0.04 + 0.96 * Math.pow(1 - ndv, 5);
      const spec = (Math.pow(Math.max(0, dot(n, half)), 60) * 0.55 + Math.pow(Math.max(0, dot(n, half)), 8) * 0.06) * (0.4 + fres);
      const rimL = Math.pow(1 - ndv, 2.5) * Math.max(0, dot(n, rim) + 0.25) * 0.55;
      const out: V3 = [0, 0, 0];
      const keyC: V3 = [1.0, 0.97, 0.92], fillC: V3 = [0.62, 0.72, 1.0], rimC: V3 = [0.85, 0.9, 1.0];
      for (let k = 0; k < 3; k++) {
        const diffuse = a[k]! * (keyD * 1.35 * keyC[k]! + ndf * 0.45 * fillC[k]! + amb[k]! * 0.5);
        out[k] = diffuse + spec * keyC[k]! + rimL * rimC[k]! * (0.35 + a[k]!);
      }
      col[4 * o] = tonemap(out[0] * EXPOSURE);
      col[4 * o + 1] = tonemap(out[1] * EXPOSURE);
      col[4 * o + 2] = tonemap(out[2] * EXPOSURE);
      col[4 * o + 3] = 1;
    }
  }

  // ---- lines: silhouettes from the G-buffer, B-rep edges depth-tested
  if (drawEdges && !empty) {
    const mask = new Float32Array(N);
    const lineR = 0.62 * ss; // ≈ 1.25 px wide in the output
    // silhouette / occlusion boundaries
    const zTol = radius * 0.04;
    for (let py = 0; py < SH; py++)
      for (let px = 0; px < SW; px++) {
        const o = py * SW + px;
        const p = pid[o]!;
        if (p < 0) continue;
        let edge = false;
        for (let d = 1; d <= Math.max(1, Math.round(lineR)) && !edge; d++) {
          for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]] as const) {
            const x = px + dx, y = py + dy;
            if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
            const q = y * SW + x;
            if (pid[q]! !== p || (pid[q]! >= 0 && depth[q]! - depth[o]! > zTol)) {
              edge = true;
              break;
            }
          }
        }
        if (edge) mask[o] = 1;
      }
    /**
     * Whether a B-rep edge is smooth (a seam, or the tangent boundary of a fillet): sample the
     * G-buffer on both sides of it and compare the surface normals.
     */
    const isSmooth = (pts: Float32Array, base: number, n: number): boolean => {
      let smooth = 0, sharp = 0;
      const samples = Math.min(n - 1, 9);
      for (let s = 0; s < samples; s++) {
        const i = base + Math.floor(((s + 0.5) * (n - 1)) / samples);
        const A = toScreen(pts[3 * i]!, pts[3 * i + 1]!, pts[3 * i + 2]!);
        const B = toScreen(pts[3 * i + 3]!, pts[3 * i + 4]!, pts[3 * i + 5]!);
        const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
        const o0 = Math.floor(my) * SW + Math.floor(mx);
        if (mx < 0 || my < 0 || mx >= SW || my >= SH) continue;
        const mz = (A[2] + B[2]) / 2;
        if (pid[o0]! < 0 || mz > depth[o0]! + radius * 0.01) continue; // hidden here: no vote
        let dx = B[0] - A[0], dy = B[1] - A[1];
        const l = Math.hypot(dx, dy);
        if (l < 1e-6) continue;
        // perpendicular, a couple of output pixels out
        const off = 2.5 * ss;
        dx = (-dy / l) * off;
        dy = ((B[0] - A[0]) / l) * off;
        const a = Math.floor(my + dy) * SW + Math.floor(mx + dx), b = Math.floor(my - dy) * SW + Math.floor(mx - dx);
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        if (pid[a]! < 0 || pid[b]! < 0) continue; // on a silhouette: no vote
        if (pid[a] !== pid[b]) {
          sharp++;
          continue;
        }
        // a step in depth across the edge (an engraving's rim, a ledge): not smooth, even when
        // the faces on both sides are parallel. A continuous surface changes depth evenly.
        const m0 = Math.floor(my) * SW + Math.floor(mx);
        const pixelWorld = (ortho ? 1 : depth[m0]!) / scale;
        if (Math.abs(depth[a]! - 2 * depth[m0]! + depth[b]!) > pixelWorld * off * 0.6 || Math.abs(depth[a]! - depth[b]!) > radius * 0.05) {
          sharp++;
          continue;
        }
        const d = nrm[3 * a]! * nrm[3 * b]! + nrm[3 * a + 1]! * nrm[3 * b + 1]! + nrm[3 * a + 2]! * nrm[3 * b + 2]!;
        const la = Math.hypot(nrm[3 * a]!, nrm[3 * a + 1]!, nrm[3 * a + 2]!), lb = Math.hypot(nrm[3 * b]!, nrm[3 * b + 1]!, nrm[3 * b + 2]!);
        if (d / (la * lb || 1) > 0.97) smooth++;
        else sharp++;
      }
      return smooth > 0 && smooth >= sharp * 2;
    };
    // B-rep edges
    for (const part of parts) {
      const pts = part.mesh.edgePoints, counts = part.mesh.edgeCounts;
      if (!pts || !counts) continue;
      let base = 0;
      for (let e = 0; e < counts.length; e++) {
        const n = counts[e]!;
        if (!opts.smoothEdges && isSmooth(pts, base, n)) {
          base += n;
          continue;
        }
        for (let i = 0; i + 1 < n; i++) {
          const j = 3 * (base + i), k = 3 * (base + i + 1);
          const A = toScreen(pts[j]!, pts[j + 1]!, pts[j + 2]!), B = toScreen(pts[k]!, pts[k + 1]!, pts[k + 2]!);
          stampSegment(A, B, lineR, mask, depth, SW, SH, radius, scale, ortho);
        }
        base += n;
      }
    }
    for (let o = 0; o < N; o++) {
      const m = mask[o]! * th.edgeAlpha;
      if (m <= 0) continue;
      col[4 * o] = col[4 * o]! * (1 - m) + th.edge[0] * m;
      col[4 * o + 1] = col[4 * o + 1]! * (1 - m) + th.edge[1] * m;
      col[4 * o + 2] = col[4 * o + 2]! * (1 - m) + th.edge[2] * m;
      col[4 * o + 3] = Math.max(col[4 * o + 3]!, m);
    }
  }

  // ---- downsample (box filter) to 8-bit RGBA
  const data = new Uint8Array(W * H * 4);
  const inv = 1 / (ss * ss);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const o = 4 * ((y * ss + j) * SW + x * ss + i);
          const a = col[o + 3]!;
          r += col[o]! * a;
          g += col[o + 1]! * a;
          b += col[o + 2]! * a;
          al += a;
        }
      const q = 4 * (y * W + x);
      const A = al * inv;
      const un = al > 0 ? 1 / al : 0;
      // ordered dither of ±0.5 LSB hides banding in the background gradient
      const d = (((x * 7 + y * 13) & 15) / 16 - 0.5) / 255;
      data[q] = to8(r * un + d);
      data[q + 1] = to8(g * un + d);
      data[q + 2] = to8(b * un + d);
      data[q + 3] = to8(A);
    }
  return { width: W, height: H, data };
}

/** Render `parts` to a PNG file (bytes). */
export function renderPNG(parts: RenderPart[], opts: RenderOptions = {}): Uint8Array {
  const img = renderImage(parts, opts);
  if (opts.background === "transparent") return encodePNG(img.data, img.width, img.height, 4);
  const rgb = new Uint8Array(img.width * img.height * 3);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) {
    rgb[j] = img.data[i]!;
    rgb[j + 1] = img.data[i + 1]!;
    rgb[j + 2] = img.data[i + 2]!;
  }
  return encodePNG(rgb, img.width, img.height, 3);
}

// ---------------------------------------------------------------------------------------------

const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Linear radiance → display sRGB (a soft filmic shoulder, then the sRGB curve). */
function tonemap(x: number): number {
  // ACES-ish fit (Narkowicz), slightly desaturating highlights
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  const y = Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
  return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
}

/** Separable box blur, `passes` times (≈ gaussian). */
function blur(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const norm = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc * norm;
        acc += a[y * w + Math.min(w - 1, x + r + 1)]! - a[y * w + Math.max(0, x - r)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * norm;
        acc += b[Math.min(h - 1, y + r + 1) * w + x]! - b[Math.max(0, y - r) * w + x]!;
      }
    }
  }
  return a;
}

/** Stamp an anti-aliased, depth-tested line segment into `mask`. */
function stampSegment(
  A: [number, number, number],
  B: [number, number, number],
  r: number,
  mask: Float32Array,
  depth: Float32Array,
  W: number,
  H: number,
  radius: number,
  scale: number,
  ortho: boolean,
): void {
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0]) - r - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0]) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1]) - r - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1]) + r + 1));
  if (x0 > x1 || y0 > y1) return;
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const l2 = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let t = l2 > 0 ? ((px - A[0]) * dx + (py - A[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = A[0] + t * dx, qy = A[1] + t * dy;
      const d = Math.hypot(px - qx, py - qy);
      const cov = Math.max(0, Math.min(1, r + 0.5 - d));
      if (cov <= 0) continue;
      // depth along the segment (perspective: interpolate 1/z)
      const z = ortho ? A[2] + t * (B[2] - A[2]) : 1 / (1 / A[2] + t * (1 / B[2] - 1 / A[2]));
      // tolerance: a few pixels' worth of depth plus a sliver of the scene
      const pixelWorld = ortho ? 1 / scale : z / scale;
      const tol = radius * 0.004 + pixelWorld * (r + 2) * 2;
      // look at the nearest surface around the pixel (edges sit on silhouettes too)
      const o = y * W + x;
      const surf = depth[o]!;
      if (surf !== Infinity && z > surf + tol) continue;
      if (cov > mask[o]!) mask[o] = cov;
      void len;
    }
}
