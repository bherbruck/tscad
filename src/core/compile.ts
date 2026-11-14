/**
 * compile: rendered element tree → IR `Document`, with a source map from every IR node path
 * (`parts/0/1/0`, the kernel's own numbering) to the JSX that produced it.
 */
import type { Curve, Document, Node, Part, Selector } from "../ir";
import { makeElement, type Children, type Component } from "./element";
import { TscadError, type SourceLoc } from "./errors";
import { materials, type Material } from "./materials";
import {
  axisVector, chain, DEG, identity, isIdentity, mul, normalize, reflection, rotationAxis, rotationXYZ,
  scaling, tidy, translation, type Mat4, type Vec3,
} from "./math";
import { resolveParams, type ParamIssue, type ParamSchema, type ParamValues } from "./params";
import type { Path3 } from "./paths";
import { polyline3 } from "./paths";
import { render, type Host } from "./render";
import { layoutText, loadFont } from "./text/font";
import { toSelector, type SelectorLike } from "./select";
import { parsePath, PathSyntaxError } from "./sketch/path";
import { ccw, frame, frameAcross, pathStart, PLANES, regions, toCurves, type Frame, type PlaneName } from "./sketch/place";
import { closureGap, ID2, loopSize, mul2, polyline, rot2, tr2, transformLoop, type Affine2, type Loop2 } from "./sketch/seg";
import {
  circleLoop, ellipseLoop, polygonLoop, rectLoop, regularPolygonPoints, roundedRectLoop, slotLoop, starPoints,
} from "./sketch/shapes";

/** Extra facts about each part that the IR doesn't carry. */
export interface PartInfo {
  name: string;
  color?: string;
  /** Material preset key, if given. */
  material?: string;
  /** g/cm³, from `density` or the material. */
  density?: number;
  /** `false` parts are not in the document. */
  visible: boolean;
  /** Index in `document.parts` (−1 when not visible). */
  index: number;
  loc?: SourceLoc;
}

export interface CompileResult {
  /** The IR to evaluate. */
  document: Document;
  /** IR node path (`parts/0/1`) → the JSX element that produced the node. */
  sourceMap: Record<string, SourceLoc>;
  /** Non-fatal problems (ignored props, empty groups, clamped params...). */
  warnings: string[];
  /** Per-part metadata (material, density, visibility). */
  parts: PartInfo[];
}

export interface CompileOptions {
  /** Name of the implicit part made for loose solids. Default `"part"`. */
  defaultPartName?: string;
}

/** Compile a JSX element (or several) into an IR document. Throws {@link TscadError}. */
export function compile(element: Children, options: CompileOptions = {}): CompileResult {
  const warnings: string[] = [];
  const hosts = render(element, { warnings });
  return new Compiler(warnings, options).document(hosts);
}

/** A user model module: a default-exported component and optional `params`. */
export interface TscadModule {
  default: Component<any>;
  params?: ParamSchema;
  [k: string]: unknown;
}

export interface RenderResult<S extends ParamSchema = ParamSchema> extends CompileResult {
  /** The module's param schema (`{}` when it has none). */
  params: S;
  /** The values the model was rendered with (defaults merged with overrides, clamped). */
  values: ParamValues<S>;
  /** Overrides that were coerced, clamped or unknown. */
  paramIssues: ParamIssue[];
}

/**
 * Render a user module with its params: defaults merged with `overrides` (coerced and
 * clamped), `<Default {...values} />` compiled.
 */
export function renderModule<S extends ParamSchema = ParamSchema>(
  mod: { default: Component<any>; params?: S },
  overrides: Record<string, unknown> = {},
  options: CompileOptions = {},
): RenderResult<S> {
  if (!mod || typeof mod.default !== "function") {
    throw new TscadError("the model module has no default export — export default a component: `export default function Model() { return <box size={10} /> }`");
  }
  const schema = (mod.params ?? {}) as S;
  const { values, issues } = resolveParams(schema, overrides);
  const result = compile(makeElement(mod.default, { ...values }, null), options);
  return {
    ...result,
    warnings: [...issues.map((i) => `param ${i.key}: ${i.message}`), ...result.warnings],
    params: schema,
    values,
    paramIssues: issues,
  };
}

// ---------------------------------------------------------------------------------------------

const SOLID_TAGS = new Set([
  "group", "step", "translate", "rotate", "scale", "mirror", "box", "cylinder", "cone", "sphere", "torus",
  "union", "difference", "subtract", "intersection", "intersect", "extrude", "revolve", "loft", "sweep",
  "linearPattern", "gridPattern", "polarPattern", "fillet", "chamfer", "shell",
]);
const SHAPE_TAGS = new Set(["text", "rect", "roundedRect", "circle", "ellipse", "polygon", "regularPolygon", "slot", "path", "star"]);
const SKETCH_TAGS = new Set([...SHAPE_TAGS, "sketch", "section"]);
const CONTAINER_TAGS = new Set(["part", "assembly"]);
const ALL_TAGS = [...SOLID_TAGS, ...SKETCH_TAGS, ...CONTAINER_TAGS];
/** Tags whose x/y/z mean something else (no universal placement). */
const OWN_TRANSFORM = new Set(["translate", "rotate", "scale", "mirror"]);

interface SketchLoop {
  loop: Loop2;
  host: Host;
}

class Compiler {
  readonly locs = new WeakMap<object, SourceLoc>();
  /** Unions made only to group children: a transform may take their children directly. */
  readonly soft = new WeakSet<Node>();

  constructor(
    readonly warnings: string[],
    readonly options: CompileOptions,
  ) {}

  // ---- diagnostics

  emit<T extends Node>(node: T, h: Host | undefined): T {
    if (h?.loc && !this.locs.has(node)) this.locs.set(node, h.loc);
    return node;
  }

  fail(h: Host | undefined, message: string, hint?: string, cause?: unknown): never {
    throw new TscadError(message, { ...(h?.loc ? { loc: h.loc } : {}), ...(hint ? { hint } : {}), ...(cause ? { cause } : {}) });
  }

  warn(h: Host | undefined, message: string): void {
    const where = h?.loc ? `${h.loc.file}:${h.loc.line}:${h.loc.column}: ` : "";
    this.warnings.push(`${where}<${h?.tag ?? "?"}> ${message}`);
  }

  /** A finite number prop, optional. */
  num(h: Host, name: string, v: unknown, opts: { positive?: boolean; nonNegative?: boolean; nonZero?: boolean; int?: boolean; min?: number } = {}): number | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) this.fail(h, `${name} must be a finite number (got ${show(v)})`);
    if (opts.positive && !(v > 0)) this.fail(h, `${name} must be greater than 0 (got ${v})`, hintFor(h.tag, name));
    if (opts.nonNegative && v < 0) this.fail(h, `${name} must not be negative (got ${v})`);
    if (opts.nonZero && v === 0) this.fail(h, `${name} must not be 0`);
    if (opts.int && !Number.isInteger(v)) this.fail(h, `${name} must be a whole number (got ${v})`);
    if (opts.min !== undefined && v < opts.min) this.fail(h, `${name} must be at least ${opts.min} (got ${v})`);
    return v;
  }

  req(h: Host, name: string, v: number | undefined, what?: string): number {
    if (v === undefined) this.fail(h, `missing ${what ?? name}`, hintFor(h.tag, name));
    return v;
  }

  vec3(h: Host, name: string, v: unknown): Vec3 | undefined {
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
      this.fail(h, `${name} must be [x, y, z] numbers (got ${show(v)})`);
    }
    return [v[0], v[1], v[2]];
  }

  /** The first defined of several aliases (warns when two disagree). */
  alias(h: Host, names: string[], opts: Parameters<Compiler["num"]>[3] = {}): number | undefined {
    let found: [string, number] | undefined;
    for (const n of names) {
      const v = this.num(h, n, h.props[n], opts);
      if (v === undefined) continue;
      if (found && found[1] !== v) this.warn(h, `both ${found[0]}=${found[1]} and ${n}=${v} given; using ${found[0]}`);
      if (!found) found = [n, v];
    }
    return found?.[1];
  }

  /** A radius from r / radius / d / diameter. */
  radius(h: Host, opts: { r?: string[]; d?: string[] } = {}): number | undefined {
    const r = this.alias(h, opts.r ?? ["r", "radius"], { positive: true });
    const d = this.alias(h, opts.d ?? ["d", "diameter"], { positive: true });
    if (r !== undefined && d !== undefined && Math.abs(r * 2 - d) > 1e-12) this.warn(h, `both a radius (${r}) and a diameter (${d}) given; using the radius`);
    return r ?? (d !== undefined ? d / 2 : undefined);
  }

  // ---- document

  document(roots: Host[]): CompileResult {
    const parts: { part: Part; info: PartInfo; host: Host }[] = [];
    const loose: Node[] = [];
    const looseHosts: Host[] = [];
    const visit = (h: Host, m: Mat4): void => {
      if (h.tag === "part") {
        const body = this.group(h.children, h);
        const node = body && this.wrap(h, body, mul(m, this.placement(h)));
        if (!node) {
          this.warn(h, `part ${h.props.name ? JSON.stringify(h.props.name) : ""} is empty; skipped`);
          return;
        }
        parts.push({ part: { name: "", node }, info: this.partInfo(h), host: h });
        return;
      }
      if (h.tag === "assembly") {
        const mm = mul(m, this.placement(h));
        for (const c of h.children) visit(c, mm);
        return;
      }
      const node = this.solid(h);
      if (node) {
        loose.push(this.wrap(h, node, m));
        looseHosts.push(h);
      }
    };
    for (const r of roots) visit(r, identity());

    if (loose.length) {
      const name = this.options.defaultPartName ?? "part";
      const node = loose.length === 1 ? loose[0]! : this.emit({ type: "union", children: loose } as Node, looseHosts[0]);
      if (parts.length) this.warnings.push(`${loose.length} solid(s) outside any <part> were collected into a part named "${name}"`);
      const host = looseHosts[0]!;
      parts.push({ part: { name, node }, info: { name, visible: true, index: 0, ...(host.loc ? { loc: host.loc } : {}) }, host });
    }

    // unique names, visibility
    const used = new Map<string, number>();
    const doc: Part[] = [];
    const infos: PartInfo[] = [];
    for (const { part, info, host } of parts) {
      let name = info.name;
      const n = used.get(name) ?? 0;
      used.set(name, n + 1);
      if (n > 0) {
        let k = n + 1;
        while (used.has(`${name}-${k}`)) k++;
        const renamed = `${name}-${k}`;
        used.set(renamed, 1);
        this.warn(host, `duplicate part name ${JSON.stringify(name)}; renamed to ${JSON.stringify(renamed)}`);
        name = renamed;
      }
      info.name = name;
      part.name = name;
      if (info.color) part.color = info.color;
      if (info.visible) {
        info.index = doc.length;
        doc.push(part);
      } else info.index = -1;
      infos.push(info);
    }

    const sourceMap: Record<string, SourceLoc> = {};
    const walk = (node: Node, path: string, inherited: SourceLoc | undefined) => {
      const loc = this.locs.get(node) ?? inherited;
      if (loc) sourceMap[path] = loc;
      if ("children" in node) node.children.forEach((c, i) => walk(c, `${path}/${i}`, loc));
    };
    doc.forEach((p, i) => walk(p.node, `parts/${i}`, infos.find((x) => x.index === i)?.loc));
    return { document: { parts: doc }, sourceMap, warnings: this.warnings, parts: infos };
  }

  partInfo(h: Host): PartInfo {
    const name = h.props.name;
    if (name !== undefined && (typeof name !== "string" || name === "")) this.fail(h, `name must be a non-empty string (got ${show(name)})`);
    const info: PartInfo = { name: name ?? "part", visible: h.props.visible !== false, index: -1 };
    if (h.loc) info.loc = h.loc;
    let mat: Material | undefined;
    if (h.props.material !== undefined) {
      const key = String(h.props.material).toLowerCase();
      mat = (materials as Record<string, Material>)[key];
      if (!mat) this.warn(h, `unknown material ${JSON.stringify(h.props.material)} (known: ${Object.keys(materials).join(", ")})`);
      info.material = key;
    }
    const color = h.props.color ?? mat?.color;
    if (color !== undefined) info.color = String(color);
    const density = this.num(h, "density", h.props.density, { positive: true }) ?? mat?.density;
    if (density !== undefined) info.density = density;
    return info;
  }

  // ---- solids

  /** Several children as one node (soft union), or null when they build nothing. */
  group(children: Host[], h: Host): Node | null {
    const nodes = this.solids(children);
    if (nodes.length === 0) return null;
    if (nodes.length === 1) return nodes[0]!;
    const u = this.emit({ type: "union", children: nodes } as Node, h);
    this.soft.add(u);
    return u;
  }

  solids(children: Host[]): Node[] {
    const out: Node[] = [];
    for (const c of children) {
      const n = this.solid(c);
      if (n) out.push(n);
    }
    return out;
  }

  /** Placement props → matrix (mirror, scale, rotate, translate). */
  placement(h: Host): Mat4 {
    if (OWN_TRANSFORM.has(h.tag)) return identity();
    const p = h.props;
    const at = this.vec3(h, "at", p.at) ?? [0, 0, 0];
    const x = at[0] + (this.num(h, "x", p.x) ?? 0);
    const y = at[1] + (this.num(h, "y", p.y) ?? 0);
    const z = at[2] + (this.num(h, "z", p.z) ?? 0);
    const r = this.vec3(h, "rotate", p.rotate) ?? [0, 0, 0];
    const rx = r[0] + (this.num(h, "rotateX", p.rotateX) ?? 0);
    const ry = r[1] + (this.num(h, "rotateY", p.rotateY) ?? 0);
    const rz = r[2] + (this.num(h, "rotateZ", p.rotateZ) ?? 0);
    const s = this.num(h, "scale", p.scale, { nonZero: true });
    const steps: Mat4[] = [];
    if (p.mirror !== undefined) {
      if (!["x", "y", "z"].includes(p.mirror)) this.fail(h, `mirror must be "x", "y" or "z" (got ${show(p.mirror)})`);
      steps.push(reflection(axisVector(p.mirror)));
    }
    if (s !== undefined && s !== 1) steps.push(scaling(s));
    if (rx || ry || rz) steps.push(rotationXYZ(rx, ry, rz));
    if (x || y || z) steps.push(translation(x, y, z));
    return chain(...steps);
  }

  /** `node` moved by `m` (identity: unchanged). */
  wrap(h: Host, node: Node, m: Mat4): Node {
    if (isIdentity(m)) return node;
    const children = node.type === "union" && this.soft.has(node) ? node.children : [node];
    return this.emit({ type: "transform", matrix: tidy(m) as any, children }, h);
  }

  solid(h: Host): Node | null {
    if (SHAPE_TAGS.has(h.tag) || h.tag === "sketch" || h.tag === "section") {
      this.fail(h, `<${h.tag}> is a 2D sketch shape and can't stand alone as a solid`, `put it inside <extrude height={...}>, <revolve>, <loft> or <sweep>`);
    }
    if (CONTAINER_TAGS.has(h.tag)) {
      this.fail(h, `<${h.tag}> can't be nested inside a solid`, `<part> and <assembly> belong at the top of the model (assemblies may contain parts)`);
    }
    if (!SOLID_TAGS.has(h.tag)) {
      const guess = closest(h.tag, ALL_TAGS);
      this.fail(h, `unknown element <${h.tag}>`, guess ? `did you mean <${guess}>?` : undefined);
    }
    const r = this.local(h);
    if (!r) return null;
    const [node, pre] = r;
    return this.wrap(h, node, pre ? mul(this.placement(h), pre) : this.placement(h));
  }

  /** The element's node in its own frame, plus an offset applied before placement. */
  local(h: Host): [Node, Mat4?] | null {
    const p = h.props;
    const noKids = () => {
      if (h.children.length) this.warn(h, `children are ignored on <${h.tag}>`);
    };
    switch (h.tag) {
      case "group":
      case "union": {
        const g = this.group(h.children, h);
        if (!g) this.warn(h, "is empty");
        return g ? [g] : null;
      }
      case "difference":
      case "subtract": {
        const nodes = this.solids(h.children);
        if (nodes.length === 0) this.fail(h, "is empty", "<difference> keeps its first child and subtracts the rest");
        if (nodes.length === 1) {
          this.warn(h, "has only one child, so nothing is subtracted");
          return [nodes[0]!];
        }
        return [this.emit({ type: "difference", children: nodes }, h)];
      }
      case "intersection":
      case "intersect": {
        const nodes = this.solids(h.children);
        if (nodes.length === 0) this.fail(h, "is empty");
        if (nodes.length === 1) return [nodes[0]!];
        return [this.emit({ type: "intersection", children: nodes }, h)];
      }
      case "translate": {
        const by = this.vec3(h, "by", p.by) ?? [0, 0, 0];
        const m = translation(by[0] + (this.num(h, "x", p.x) ?? 0), by[1] + (this.num(h, "y", p.y) ?? 0), by[2] + (this.num(h, "z", p.z) ?? 0));
        return this.transformed(h, m);
      }
      case "rotate": {
        let m: Mat4;
        if (p.axis !== undefined || p.angle !== undefined) {
          const axis = typeof p.axis === "string" ? axisVector(p.axis as "x") : this.vec3(h, "axis", p.axis) ?? [0, 0, 1];
          if (axis.every((v) => v === 0)) this.fail(h, "axis must not be zero");
          m = rotationAxis(axis, this.num(h, "angle", p.angle) ?? 0);
        } else {
          const by = this.vec3(h, "by", p.by) ?? [0, 0, 0];
          m = rotationXYZ(by[0] + (this.num(h, "x", p.x) ?? 0), by[1] + (this.num(h, "y", p.y) ?? 0), by[2] + (this.num(h, "z", p.z) ?? 0));
        }
        return this.transformed(h, this.about(h, m));
      }
      case "scale": {
        const by = p.by;
        let m: Mat4;
        if (typeof by === "number") m = scaling(this.num(h, "by", by, { nonZero: true })!);
        else {
          const v = this.vec3(h, "by", by);
          if (!v) this.fail(h, "missing by", "<scale by={2}> or <scale by={[1, 1, 2]}>");
          if (v.some((x) => x === 0)) this.fail(h, "scale factors must not be 0");
          if (!(v[0] === v[1] && v[1] === v[2])) this.warn(h, "non-uniform scale turns analytic faces into NURBS");
          m = scaling(v[0], v[1], v[2]);
        }
        return this.transformed(h, this.about(h, m));
      }
      case "mirror": {
        const n = typeof p.axis === "string" ? (["x", "y", "z"].includes(p.axis) ? axisVector(p.axis as "x") : this.fail(h, `axis must be "x", "y", "z" or a vector (got ${show(p.axis)})`)) : this.vec3(h, "axis", p.axis);
        if (!n) this.fail(h, "missing axis", `<mirror axis="x">`);
        if (n.every((v) => v === 0)) this.fail(h, "axis must not be zero");
        const m = this.about(h, reflection(n));
        const body = this.group(h.children, h);
        if (!body) return null;
        const mirrored = this.emit({ type: "transform", matrix: tidy(m) as any, children: this.soft.has(body) && body.type === "union" ? body.children : [body] } as Node, h);
        if (!p.keep) return [mirrored];
        return [this.emit({ type: "union", children: [body, mirrored] }, h)];
      }

      case "box": {
        noKids();
        let size: Vec3 | undefined;
        if (p.size !== undefined) {
          size = typeof p.size === "number" ? [p.size, p.size, p.size] : this.vec3(h, "size", p.size);
        }
        const w = this.alias(h, ["width", "w"]) ?? size?.[0];
        const d = this.alias(h, ["depth", "d"]) ?? size?.[1];
        const ht = this.alias(h, ["height", "h"]) ?? size?.[2];
        if (w === undefined || d === undefined || ht === undefined) {
          this.fail(h, `needs a size (missing ${[w === undefined && "width", d === undefined && "depth", ht === undefined && "height"].filter(Boolean).join(", ")})`, "<box size={[x, y, z]} /> or <box w={..} d={..} h={..} />");
        }
        for (const [n, v] of [["width", w], ["depth", d], ["height", ht]] as const) if (!(v > 0)) this.fail(h, `${n} must be greater than 0 (got ${v})`);
        const c = this.center(h, [true, true, false]);
        if (c.every(Boolean)) return [this.emit({ type: "box", size: [w, d, ht], center: true }, h)];
        const off = translation(c[0] ? -w / 2 : 0, c[1] ? -d / 2 : 0, c[2] ? -ht / 2 : 0);
        return [this.emit({ type: "box", size: [w, d, ht] }, h), off];
      }
      case "cylinder": {
        noKids();
        const r = this.req(h, "r", this.radius(h), "radius (r, radius, d or diameter)");
        const ht = this.req(h, "h", this.alias(h, ["h", "height"], { positive: true }), "height (h or height)");
        const c = this.center(h, [true, true, false]);
        const node: Node = c[2] ? { type: "cylinder", radius: r, height: ht, center: true } : { type: "cylinder", radius: r, height: ht };
        return [this.emit(node, h), translation(c[0] ? 0 : r, c[1] ? 0 : r, 0)];
      }
      case "cone": {
        noKids();
        const r1 = this.alias(h, ["r1"], { nonNegative: true }) ?? halve(this.alias(h, ["d1"], { nonNegative: true }));
        const r2 = this.alias(h, ["r2"], { nonNegative: true }) ?? halve(this.alias(h, ["d2"], { nonNegative: true }));
        if (r1 === undefined || r2 === undefined) this.fail(h, "needs r1 and r2 (or d1 and d2)", "<cone r1={10} r2={0} h={20} />");
        if (r1 === 0 && r2 === 0) this.fail(h, "r1 and r2 can't both be 0");
        const ht = this.req(h, "h", this.alias(h, ["h", "height"], { positive: true }), "height (h or height)");
        const c = this.center(h, [true, true, false]);
        const R = Math.max(r1, r2);
        const node: Node = { type: "cone", bottomRadius: r1, topRadius: r2, height: ht, ...(c[2] ? { center: true } : {}) };
        return [this.emit(node, h), translation(c[0] ? 0 : R, c[1] ? 0 : R, 0)];
      }
      case "sphere": {
        noKids();
        const r = this.req(h, "r", this.radius(h), "radius (r, radius, d or diameter)");
        const c = this.center(h, [true, true, true]);
        return [this.emit({ type: "sphere", radius: r }, h), translation(c[0] ? 0 : r, c[1] ? 0 : r, c[2] ? 0 : r)];
      }
      case "torus": {
        noKids();
        const R = this.req(h, "R", this.alias(h, ["R", "major"], { positive: true }), "major radius (R or major)");
        const r = this.req(h, "r", this.alias(h, ["r", "minor"], { positive: true }), "minor radius (r or minor)");
        if (r >= R) this.fail(h, `minor radius (${r}) must be smaller than the major radius (${R})`, "a torus with r ≥ R self-intersects");
        return [this.emit({ type: "torus", majorRadius: R, minorRadius: r }, h)];
      }

      case "step": {
        noKids();
        if (typeof p.data !== "string" || p.data.trim() === "") {
          this.fail(h, "needs data: the STEP file's text", `import bracket from "./bracket.step" with { type: "text" }  →  <step data={bracket} />`);
        }
        if (!/ISO-10303-21/.test(p.data.slice(0, 200))) this.warn(h, "data doesn't start like a STEP file (ISO-10303-21)");
        const solid = this.num(h, "solid", p.solid, { int: true, min: 0 });
        return [this.emit({ type: "step", data: p.data, ...(solid !== undefined ? { solid } : {}) } as Node, h)];
      }
      case "extrude":
        return [this.extrude(h)];
      case "revolve":
        return [this.revolve(h)];
      case "loft":
        return [this.loft(h)];
      case "sweep":
        return [this.sweep(h)];

      case "linearPattern": {
        const count = this.req(h, "count", this.num(h, "count", p.count, { int: true, min: 1 }));
        const step = this.vec3(h, "step", p.step) ?? [0, 0, 0];
        const d: Vec3 = [step[0] + (this.num(h, "dx", p.dx) ?? 0), step[1] + (this.num(h, "dy", p.dy) ?? 0), step[2] + (this.num(h, "dz", p.dz) ?? 0)];
        const k0 = p.center ? -(count - 1) / 2 : 0;
        return this.pattern(h, Array.from({ length: count }, (_, i) => translation(d[0] * (i + k0), d[1] * (i + k0), d[2] * (i + k0))));
      }
      case "gridPattern": {
        const nx = this.req(h, "nx", this.num(h, "nx", p.nx, { int: true, min: 1 }));
        const ny = this.req(h, "ny", this.num(h, "ny", p.ny, { int: true, min: 1 }));
        const dx = this.num(h, "dx", p.dx) ?? (nx > 1 ? this.fail(h, "missing dx") : 0);
        const dy = this.num(h, "dy", p.dy) ?? (ny > 1 ? this.fail(h, "missing dy") : 0);
        const centred = p.center !== false;
        const ox = centred ? -((nx - 1) * dx) / 2 : 0, oy = centred ? -((ny - 1) * dy) / 2 : 0;
        const ms: Mat4[] = [];
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) ms.push(translation(ox + i * dx, oy + j * dy, 0));
        return this.pattern(h, ms);
      }
      case "polarPattern": {
        const count = this.req(h, "count", this.num(h, "count", p.count, { int: true, min: 1 }));
        const angle = this.num(h, "angle", p.angle) ?? 360;
        const axis = p.axis ?? "z";
        if (!["x", "y", "z"].includes(axis)) this.fail(h, `axis must be "x", "y" or "z" (got ${show(axis)})`);
        const radius = this.num(h, "radius", p.radius) ?? 0;
        const a0 = this.num(h, "startAngle", p.startAngle) ?? 0;
        const full = Math.abs(Math.abs(angle) - 360) < 1e-9;
        const step = count === 1 ? 0 : full ? angle / count : angle / (count - 1);
        const out = radius ? (axis === "x" ? translation(0, radius, 0) : translation(radius, 0, 0)) : identity();
        return this.pattern(h, Array.from({ length: count }, (_, i) => mul(rotationAxis(axisVector(axis), a0 + step * i), out)));
      }

      case "fillet":
      case "chamfer": {
        const isF = h.tag === "fillet";
        const size = isF ? this.alias(h, ["radius", "r"], { nonNegative: true }) : this.alias(h, ["distance", "d"], { nonNegative: true });
        if (size === undefined) this.fail(h, isF ? "missing radius" : "missing distance", isF ? "<fillet radius={2} edges={edges.top()}>" : "<chamfer distance={1}>");
        const kids = this.solids(h.children);
        if (kids.length === 0) {
          this.warn(h, "is empty");
          return null;
        }
        if (size === 0) return [kids.length === 1 ? kids[0]! : this.soften(this.emit({ type: "union", children: kids }, h))];
        const edges = p.edges === undefined ? undefined : this.selector(h, "edges", p.edges);
        const node: Node = isF
          ? { type: "fillet", radius: size, ...(edges ? { edges } : {}), children: kids }
          : { type: "chamfer", distance: size, ...(edges ? { edges } : {}), children: kids };
        return [this.emit(node, h)];
      }
      case "shell": {
        // magnitude = wall; inward unless `outward` (a negative thickness, the IR's convention, is inward too)
        const t = Math.abs(this.req(h, "thickness", this.num(h, "thickness", p.thickness, { nonZero: true })));
        const kids = this.solids(h.children);
        if (kids.length === 0) {
          this.warn(h, "is empty");
          return null;
        }
        const faces = p.open === undefined ? undefined : this.selector(h, "open", p.open);
        return [this.emit({ type: "shell", thickness: p.outward ? t : -t, ...(faces ? { faces } : {}), children: kids }, h)];
      }
    }
    return this.fail(h, `unhandled element <${h.tag}>`);
  }

  soften(n: Node): Node {
    this.soft.add(n);
    return n;
  }

  /** `m` about `origin` when given. */
  about(h: Host, m: Mat4): Mat4 {
    const o = this.vec3(h, "origin", h.props.origin);
    if (!o) return m;
    return chain(translation(-o[0], -o[1], -o[2]), m, translation(o[0], o[1], o[2]));
  }

  transformed(h: Host, m: Mat4): [Node] | null {
    const body = this.group(h.children, h);
    if (!body) {
      this.warn(h, "is empty");
      return null;
    }
    return [this.wrap(h, body, m)];
  }

  pattern(h: Host, ms: Mat4[]): [Node] | null {
    const body = this.group(h.children, h);
    if (!body) {
      this.warn(h, "is empty");
      return null;
    }
    const copies = ms.map((m) => this.wrap(h, body, m));
    if (copies.length === 1) return [copies[0]!];
    return [this.soften(this.emit({ type: "union", children: copies }, h))];
  }

  center(h: Host, dflt: [boolean, boolean, boolean]): [boolean, boolean, boolean] {
    const c = h.props.center;
    if (c === undefined) return dflt;
    if (typeof c === "boolean") return [c, c, c];
    if (Array.isArray(c) && c.length === 3 && c.every((x) => typeof x === "boolean")) return [c[0] === true, c[1] === true, c[2] === true];
    return this.fail(h, `center must be a boolean or [bx, by, bz] (got ${show(c)})`);
  }

  selector(h: Host, name: string, v: unknown): Selector {
    try {
      return toSelector(v as SelectorLike);
    } catch (e) {
      return this.fail(h, `${name}: ${(e as Error).message}`, `use edges.top(), ">Z", "|Z or >Z", ... (see the edges/faces docs)`, e);
    }
  }

  // ---- sketches

  /** 2D children → placed loops. */
  sketch(children: Host[], m: Affine2, parent: Host, allowSection = false): SketchLoop[] {
    const out: SketchLoop[] = [];
    for (const c of children) {
      if (c.tag === "sketch") {
        out.push(...this.sketch(c.children, mul2(m, this.place2(c)), parent));
        continue;
      }
      if (c.tag === "section") {
        if (!allowSection) this.fail(c, "<section> only goes inside <loft>");
        out.push(...this.sketch(c.children, m, parent));
        continue;
      }
      if (!SHAPE_TAGS.has(c.tag)) {
        if (SOLID_TAGS.has(c.tag) || CONTAINER_TAGS.has(c.tag)) {
          this.fail(c, `<${c.tag}> is a solid; <${parent.tag}> takes 2D shapes`, "use <rect>, <circle>, <polygon>, <path>... (wrap solids in <union>/<difference> instead)");
        }
        const guess = closest(c.tag, ALL_TAGS);
        this.fail(c, `unknown element <${c.tag}>`, guess ? `did you mean <${guess}>?` : undefined);
      }
      const mm = mul2(m, this.place2(c));
      for (const loop of this.shape(c)) out.push({ loop: transformLoop(loop, mm), host: c });
    }
    return out;
  }

  place2(h: Host): Affine2 {
    const p = h.props;
    let at: [number, number] = [0, 0];
    if (p.at !== undefined) {
      if (!Array.isArray(p.at) || p.at.length !== 2 || !p.at.every((v: unknown) => typeof v === "number" && Number.isFinite(v))) this.fail(h, `at must be [x, y] (got ${show(p.at)})`);
      at = [p.at[0], p.at[1]];
    }
    const x = at[0] + (this.num(h, "x", p.x) ?? 0), y = at[1] + (this.num(h, "y", p.y) ?? 0);
    const rot = this.num(h, "rotate", p.rotate) ?? 0;
    let m: Affine2 = ID2;
    if (p.mirror !== undefined) {
      if (p.mirror === "x") m = [-1, 0, 0, 1, 0, 0];
      else if (p.mirror === "y") m = [1, 0, 0, -1, 0, 0];
      else this.fail(h, `mirror must be "x" or "y" in a sketch (got ${show(p.mirror)})`);
    }
    if (rot) m = mul2(rot2(rot), m);
    if (x || y) m = mul2(tr2(x, y), m);
    return m;
  }

  shape(h: Host): Loop2[] {
    const p = h.props;
    if (h.children.length) this.warn(h, `children are ignored on <${h.tag}>`);
    switch (h.tag) {
      case "text":
        return this.text(h);
      case "rect":
      case "roundedRect": {
        let size: [number, number] | undefined;
        if (p.size !== undefined) size = typeof p.size === "number" ? [p.size, p.size] : Array.isArray(p.size) && p.size.length === 2 ? [p.size[0], p.size[1]] : this.fail(h, `size must be a number or [w, h] (got ${show(p.size)})`);
        const w = this.alias(h, ["w", "width"], { positive: true }) ?? size?.[0];
        const ht = this.alias(h, ["h", "height"], { positive: true }) ?? size?.[1];
        if (w === undefined || ht === undefined) this.fail(h, "needs w and h (or size)", `<${h.tag} w={40} h={20} />`);
        if (!(w > 0 && ht > 0)) this.fail(h, `w and h must be greater than 0 (got ${w} × ${ht})`);
        const off: Affine2 = p.center === false ? tr2(w / 2, ht / 2) : ID2;
        if (h.tag === "rect") return [transformLoop(rectLoop(w, ht), off)];
        const r = this.alias(h, ["r", "radius"], { nonNegative: true }) ?? 0;
        if (r > Math.min(w, ht) / 2 + 1e-12) this.warn(h, `corner radius ${r} is more than half the short side; clamped to ${Math.min(w, ht) / 2}`);
        return [transformLoop(roundedRectLoop(w, ht, r), off)];
      }
      case "circle":
        return [circleLoop(this.req(h, "r", this.radius(h), "radius (r, radius, d or diameter)"))];
      case "ellipse": {
        const rx = this.req(h, "rx", this.num(h, "rx", p.rx, { positive: true }));
        const ry = this.req(h, "ry", this.num(h, "ry", p.ry, { positive: true }));
        return [rx === ry ? circleLoop(rx) : ellipseLoop(rx, ry)];
      }
      case "polygon": {
        const pts = p.points;
        if (!Array.isArray(pts) || !pts.every((q) => Array.isArray(q) && q.length === 2 && q.every((v: unknown) => typeof v === "number" && Number.isFinite(v)))) {
          this.fail(h, "points must be an array of [x, y] pairs");
        }
        const loop = polygonLoop(pts);
        if (loop.length < 3) this.fail(h, `needs at least 3 distinct points (got ${loop.length})`);
        return [loop];
      }
      case "regularPolygon": {
        const n = this.req(h, "sides", this.num(h, "sides", p.sides, { int: true, min: 3 }));
        const ap = this.num(h, "apothem", p.apothem, { positive: true }) ?? halve(this.num(h, "flats", p.flats, { positive: true }));
        const r = this.alias(h, ["r", "radius"], { positive: true }) ?? (ap !== undefined ? ap / Math.cos(Math.PI / n) : undefined);
        if (r === undefined) this.fail(h, "needs r (circumradius), apothem or flats");
        return [polygonLoop(regularPolygonPoints(n, r))];
      }
      case "slot": {
        const len = this.req(h, "length", this.num(h, "length", p.length, { positive: true }));
        const wd = this.req(h, "width", this.num(h, "width", p.width, { positive: true }));
        if (len < wd) this.warn(h, `length ${len} is less than width ${wd}; drawn as a circle`);
        return [slotLoop(len, wd)];
      }
      case "star": {
        const n = this.req(h, "points", this.num(h, "points", p.points, { int: true, min: 2 }));
        const r1 = this.req(h, "r1", this.num(h, "r1", p.r1, { positive: true }));
        const r2 = this.req(h, "r2", this.num(h, "r2", p.r2, { positive: true }));
        return [polygonLoop(starPoints(n, r1, r2))];
      }
      case "path": {
        if (typeof p.d !== "string") this.fail(h, "needs path data d=\"M ... Z\"");
        let subs;
        try {
          subs = parsePath(p.d);
        } catch (e) {
          if (e instanceof PathSyntaxError) this.fail(h, `bad path data: ${e.message}`, undefined, e);
          throw e;
        }
        if (subs.length === 0) this.fail(h, "path data draws nothing");
        return subs.map((s, i) => {
          if (!s.closed) this.fail(h, `open sketch loop (subpath ${i + 1} of ${subs.length} doesn't return to its start)`, "end each subpath with Z");
          return s.segs;
        });
      }
    }
    return this.fail(h, `unknown 2D shape <${h.tag}>`);
  }

  text(h: Host): Loop2[] {
    const p = h.props;
    const str = h.text ?? "";
    if (!str.trim()) {
      this.warn(h, "has no text");
      return [];
    }
    const size = this.num(h, "size", p.size, { positive: true }) ?? 10;
    const align = p.align ?? "left";
    if (!["left", "center", "right"].includes(align)) this.fail(h, `align must be "left", "center" or "right" (got ${show(align)})`);
    const valign = p.valign ?? "baseline";
    if (!["baseline", "top", "middle", "bottom"].includes(valign)) this.fail(h, `valign must be "baseline", "top", "middle" or "bottom" (got ${show(valign)})`);
    let font;
    try {
      font = loadFont(p.font);
    } catch (e) {
      this.fail(h, `can't read the font: ${(e as Error).message}`, "pass the bytes of a .ttf/.otf/.woff file (ArrayBuffer or Uint8Array)", e);
    }
    const r = layoutText(str, font, {
      size,
      align,
      valign,
      spacing: this.num(h, "spacing", p.spacing, { positive: true }) ?? 1,
      lineHeight: this.num(h, "lineHeight", p.lineHeight, { positive: true }) ?? 1.2,
      kerning: p.kerning !== false,
      ligatures: p.ligatures !== false,
    });
    if (r.missing.length) this.warn(h, `the font has no glyph for ${r.missing.map((c) => JSON.stringify(c)).join(", ")}; skipped`);
    return r.loops;
  }

  /** Loops of a sketch-consuming element, checked closed and given a CCW winding. */
  loops(h: Host, allowSection = false): SketchLoop[] {
    const loops = this.sketch(h.children, ID2, h, allowSection);
    if (loops.length === 0) this.fail(h, "has no 2D shapes", `<${h.tag} ...><rect w={20} h={10} /></${h.tag}>`);
    for (const l of loops) {
      const { gap } = closureGap(l.loop);
      if (gap > 1e-7 * Math.max(1, loopSize(l.loop))) this.fail(l.host, `open sketch loop (gap ${gap.toPrecision(3)} mm)`);
      l.loop = ccw(l.loop);
    }
    return loops;
  }

  /** Build each region (outer minus holes) with `make`, unioning disjoint regions. */
  regionsOf(h: Host, loops: SketchLoop[], make: (l: SketchLoop, hole: boolean) => Node): Node {
    const rs = regions(loops, (l) => l.loop);
    const nodes = rs.map((r) => {
      const outer = make(r.outer, false);
      if (!r.holes.length) return outer;
      // holes are disjoint: one union of them is ~3x faster for the kernel than N subtractions
      const holes = r.holes.map((x) => make(x, true));
      const cut = holes.length === 1 ? holes[0]! : this.emit({ type: "union", children: holes } as Node, h);
      return this.emit({ type: "difference", children: [outer, cut] } as Node, h);
    });
    return nodes.length === 1 ? nodes[0]! : this.emit({ type: "union", children: nodes } as Node, h);
  }

  extrude(h: Host): Node {
    const p = h.props;
    const height = this.alias(h, ["height", "h", "distance"], { nonZero: true });
    if (height === undefined) this.fail(h, "missing height", "<extrude height={5}>...</extrude>");
    const plane = (p.plane ?? "XY") as PlaneName;
    if (!(plane in PLANES)) this.fail(h, `plane must be "XY", "XZ" or "YZ" (got ${show(p.plane)})`);
    const draft = this.num(h, "draft", p.draft) ?? 0;
    if (Math.abs(draft) >= 90) this.fail(h, `draft must be between -90 and 90 degrees (got ${draft})`);
    const offset = this.num(h, "offset", p.offset) ?? 0;
    const base = PLANES[plane];
    const start = offset - (p.center ? height / 2 : 0);
    const f: Frame = { ...base, origin: [base.n[0] * start, base.n[1] * start, base.n[2] * start] };
    const dir: Vec3 = height > 0 ? [...base.n] : [-base.n[0], -base.n[1], -base.n[2]];
    const loops = this.loops(h);
    return this.regionsOf(h, loops, (l, hole) => {
      const node: Node = { type: "extrude", profile: toCurves(l.loop, f), direction: dir.map((v) => v + 0) as Vec3, distance: Math.abs(height) };
      if (draft) (node as { draft?: number }).draft = (hole ? -draft : draft) * DEG;
      return this.emit(node, l.host);
    });
  }

  revolve(h: Host): Node {
    const angle = this.num(h, "angle", h.props.angle) ?? 360;
    if (!(angle > 0 && angle <= 360)) this.fail(h, `angle must be in (0, 360] degrees (got ${angle})`);
    const loops = this.loops(h);
    for (const l of loops) {
      const minX = Math.min(...polyline(l.loop).map((q) => q[0]));
      if (minX < -1e-9) this.fail(l.host, `the profile crosses the axis (x reaches ${minX.toPrecision(4)})`, "in <revolve>, sketch x is the radius: keep every shape at x ≥ 0");
    }
    const f = frame([0, 0, 0], [1, 0, 0], [0, 0, 1]);
    return this.regionsOf(h, loops, (l) =>
      this.emit({ type: "revolve", profile: toCurves(l.loop, f), origin: [0, 0, 0], axis: [0, 0, 1], angle: angle === 360 ? 2 * Math.PI : angle * DEG }, l.host),
    );
  }

  loft(h: Host): Node {
    const sections: Curve[][] = [];
    for (const c of h.children) {
      let z: number | undefined;
      let ls: SketchLoop[];
      if (c.tag === "section") {
        z = this.req(c, "z", this.num(c, "z", c.props.z));
        ls = this.sketch(c.children, ID2, h);
      } else {
        z = this.num(c, "z", c.props.z);
        if (z === undefined && SHAPE_TAGS.has(c.tag)) this.fail(c, "a <loft> section needs a z", `<${c.tag} z={10} ... /> or wrap it in <section z={10}>`);
        ls = this.sketch([c], ID2, h);
      }
      if (ls.length !== 1) this.fail(c, `a loft section must be exactly one closed loop (got ${ls.length})`);
      const l = ls[0]!;
      const { gap } = closureGap(l.loop);
      if (gap > 1e-7 * Math.max(1, loopSize(l.loop))) this.fail(l.host, `open sketch loop (gap ${gap.toPrecision(3)} mm)`);
      sections.push(toCurves(ccw(l.loop), frame([0, 0, z ?? 0], [1, 0, 0], [0, 1, 0])));
    }
    if (sections.length < 2) this.fail(h, `needs at least 2 sections (got ${sections.length})`);
    return this.emit({ type: "loft", sections, ...(h.props.ruled ? { ruled: true } : {}) }, h);
  }

  sweep(h: Host): Node {
    const p = h.props;
    let path: Path3;
    const raw = p.path;
    if (!Array.isArray(raw) || raw.length === 0) this.fail(h, "needs a path", "<sweep path={helix({ radius: 10, pitch: 2, turns: 3 })}>");
    if (raw.every((q: unknown) => Array.isArray(q))) {
      try {
        path = polyline3(raw as Vec3[]);
      } catch (e) {
        this.fail(h, (e as Error).message);
      }
    } else if (raw.every((q: any) => q && typeof q === "object" && ["line", "arc", "nurbs"].includes(q.type))) path = raw as Path3;
    else this.fail(h, "path must be curves (helix(), polyline3(), arc3()...) or an array of [x, y, z] points");
    const frameName = p.frame ?? "follow";
    if (frameName !== "follow" && frameName !== "translate") this.fail(h, `frame must be "follow" or "translate" (got ${show(frameName)})`);
    const { point, tangent } = pathStart(path[0]!);
    if (tangent.every((v) => v === 0)) this.fail(h, "the path's first curve has no direction");
    const f = frameAcross(point, normalize(tangent));
    const loops = this.loops(h);
    return this.regionsOf(h, loops, (l) =>
      this.emit({ type: "sweep", profile: toCurves(l.loop, f), path, ...(frameName === "translate" ? { frame: "translate" as const } : {}) }, l.host),
    );
  }
}

// ---------------------------------------------------------------------------------------------

function halve(v: number | undefined): number | undefined {
  return v === undefined ? undefined : v / 2;
}

function show(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function hintFor(tag: string, prop: string): string | undefined {
  const examples: Record<string, string> = {
    box: "<box size={[20, 10, 5]} />",
    cylinder: "<cylinder r={5} h={10} />",
    sphere: "<sphere r={5} />",
    cone: "<cone r1={5} r2={0} h={10} />",
    torus: "<torus R={10} r={2} />",
    circle: "<circle r={5} />",
  };
  return examples[tag] ? `e.g. ${examples[tag]}` : prop ? undefined : undefined;
}

function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined, bestD = Infinity;
  for (const c of candidates) {
    const d = lev(word.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

