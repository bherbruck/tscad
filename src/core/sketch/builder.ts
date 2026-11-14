/**
 * `sketchPath()`: a fluent, unconstrained 2D path builder (turtle-style, with tangent arcs)
 * that produces SVG path data for `<path d={...} />`.
 *
 * @example
 * <path d={sketchPath().moveTo(0, 0).hLine(40).vLine(20).tangentArc(10, 180).lineTo(0, 20).close().d} />
 */

type Vec2 = [number, number];

const DEG = Math.PI / 180;
const n = (v: number) => {
  const r = Math.abs(v) < 1e-12 ? 0 : v;
  return String(Number(r.toPrecision(15)));
};

export class SketchPath {
  private parts: string[] = [];
  private p: Vec2 = [0, 0];
  private start: Vec2 = [0, 0];
  /** Unit direction of travel at the current point (from the last segment). */
  private dir: Vec2 = [1, 0];
  private open = false;

  /** The SVG path data (`M … Z`). */
  get d(): string {
    return this.parts.join(" ");
  }
  toString(): string {
    return this.d;
  }
  /** Current point. */
  get at(): Vec2 {
    return [this.p[0], this.p[1]];
  }

  /** Start a new subpath at (x, y). */
  moveTo(x: number, y: number): this {
    this.p = [x, y];
    this.start = [x, y];
    this.parts.push(`M${n(x)} ${n(y)}`);
    this.open = true;
    return this;
  }
  private need(): void {
    if (!this.open) this.moveTo(this.p[0], this.p[1]);
  }
  /** Straight line to (x, y). */
  lineTo(x: number, y: number): this {
    this.need();
    const dx = x - this.p[0], dy = y - this.p[1], l = Math.hypot(dx, dy);
    if (l > 0) this.dir = [dx / l, dy / l];
    this.p = [x, y];
    this.parts.push(`L${n(x)} ${n(y)}`);
    return this;
  }
  /** Straight line by (dx, dy). */
  line(dx: number, dy: number): this {
    return this.lineTo(this.p[0] + dx, this.p[1] + dy);
  }
  /** Horizontal line by dx. */
  hLine(dx: number): this {
    return this.line(dx, 0);
  }
  /** Vertical line by dy. */
  vLine(dy: number): this {
    return this.line(0, dy);
  }
  /** Horizontal line to x. */
  hLineTo(x: number): this {
    return this.lineTo(x, this.p[1]);
  }
  /** Vertical line to y. */
  vLineTo(y: number): this {
    return this.lineTo(this.p[0], y);
  }
  /** Line of `length` at `angle` degrees CCW from +X. */
  polarLine(length: number, angle: number): this {
    return this.line(length * Math.cos(angle * DEG), length * Math.sin(angle * DEG));
  }
  /** Line of `length` continuing in the current direction, turned by `turn` degrees (CCW +). */
  forward(length: number, turn = 0): this {
    const a = Math.atan2(this.dir[1], this.dir[0]) / DEG + turn;
    return this.polarLine(length, a);
  }

  /** Circular arc of radius `r` to (x, y); `cw` for clockwise, `large` for the long way round. */
  arcTo(x: number, y: number, r: number, opts: { cw?: boolean; large?: boolean } = {}): this {
    this.need();
    const ccw = !opts.cw;
    const q: Vec2 = [x, y];
    const c = arcCenter(this.p, q, r, ccw, !!opts.large);
    this.parts.push(`A${n(r)} ${n(r)} 0 ${opts.large ? 1 : 0} ${ccw ? 1 : 0} ${n(x)} ${n(y)}`);
    if (c) this.dir = tangentAt(q, c, ccw);
    this.p = q;
    return this;
  }
  /**
   * Arc tangent to the current direction: radius `r`, turning `sweep` degrees (positive =
   * left/CCW, negative = right/CW).
   */
  tangentArc(r: number, sweep: number): this {
    this.need();
    if (sweep === 0 || r <= 0) return this;
    const ccw = sweep > 0;
    const nrm: Vec2 = ccw ? [-this.dir[1], this.dir[0]] : [this.dir[1], -this.dir[0]];
    const c: Vec2 = [this.p[0] + nrm[0] * r, this.p[1] + nrm[1] * r];
    let rest = Math.abs(sweep);
    // SVG arcs can't do ≥ 360° in one command: split
    while (rest > 1e-9) {
      const step = Math.min(rest, 180);
      const t = step * DEG * (ccw ? 1 : -1);
      const v: Vec2 = [this.p[0] - c[0], this.p[1] - c[1]];
      const q: Vec2 = [c[0] + v[0] * Math.cos(t) - v[1] * Math.sin(t), c[1] + v[0] * Math.sin(t) + v[1] * Math.cos(t)];
      this.parts.push(`A${n(r)} ${n(r)} 0 0 ${ccw ? 1 : 0} ${n(q[0])} ${n(q[1])}`);
      this.p = q;
      rest -= step;
    }
    this.dir = tangentAt(this.p, c, ccw);
    return this;
  }
  /** Arc tangent to the current direction that ends at (x, y). */
  tangentArcTo(x: number, y: number): this {
    this.need();
    const q: Vec2 = [x, y];
    const ch: Vec2 = [q[0] - this.p[0], q[1] - this.p[1]];
    const left: Vec2 = [-this.dir[1], this.dir[0]];
    const den = 2 * (left[0] * ch[0] + left[1] * ch[1]);
    if (Math.abs(den) < 1e-12 * Math.hypot(...ch)) return this.lineTo(x, y);
    const lam = (ch[0] * ch[0] + ch[1] * ch[1]) / den;
    const c: Vec2 = [this.p[0] + left[0] * lam, this.p[1] + left[1] * lam];
    const ccw = lam > 0;
    const a0 = Math.atan2(this.p[1] - c[1], this.p[0] - c[0]);
    let a1 = Math.atan2(q[1] - c[1], q[0] - c[0]);
    if (ccw) while (a1 <= a0) a1 += 2 * Math.PI;
    else while (a1 >= a0) a1 -= 2 * Math.PI;
    const large = Math.abs(a1 - a0) > Math.PI;
    this.parts.push(`A${n(Math.abs(lam))} ${n(Math.abs(lam))} 0 ${large ? 1 : 0} ${ccw ? 1 : 0} ${n(x)} ${n(y)}`);
    this.p = q;
    this.dir = tangentAt(q, c, ccw);
    return this;
  }
  /** Close the subpath with a straight line back to its start. */
  close(): this {
    if (this.open) this.parts.push("Z");
    this.p = [this.start[0], this.start[1]];
    this.open = false;
    return this;
  }
}

function tangentAt(q: Vec2, c: Vec2, ccw: boolean): Vec2 {
  const r: Vec2 = [q[0] - c[0], q[1] - c[1]];
  const l = Math.hypot(r[0], r[1]) || 1;
  return ccw ? [-r[1] / l, r[0] / l] : [r[1] / l, -r[0] / l];
}

function arcCenter(p: Vec2, q: Vec2, r: number, ccw: boolean, large: boolean): Vec2 | undefined {
  const ch: Vec2 = [q[0] - p[0], q[1] - p[1]];
  const half = Math.hypot(ch[0], ch[1]) / 2;
  if (half === 0) return undefined;
  const R = Math.max(r, half);
  const h = Math.sqrt(R * R - half * half);
  const u: Vec2 = [ch[0] / (2 * half), ch[1] / (2 * half)];
  const left: Vec2 = [-u[1], u[0]];
  const side = ccw !== large ? 1 : -1;
  return [p[0] + ch[0] / 2 + left[0] * h * side, p[1] + ch[1] / 2 + left[1] * h * side];
}

/** Start a fluent 2D path: `sketchPath().moveTo(0, 0).hLine(10)...close().d`. */
export function sketchPath(x?: number, y?: number): SketchPath {
  const s = new SketchPath();
  if (x !== undefined && y !== undefined) s.moveTo(x, y);
  return s;
}
