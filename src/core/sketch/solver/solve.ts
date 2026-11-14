/**
 * The sketch solver: damped Gauss–Newton (Levenberg–Marquardt in its minimum-norm, "dual"
 * form) on the residual vector of a constraint system, with an exact Jacobian from forward-mode
 * AD, plus the diagnostics that make a sketch tool pleasant — degrees of freedom, which
 * variables are still free, redundant constraints and minimal conflicting sets.
 *
 * Everything is dense: sketches are small (tens to a few hundred variables).
 */
import { variable, type D } from "./dual";

/** One constraint: some residual equations over a few variables (zero when satisfied). */
export interface Constraint {
  /** Human description for diagnostics, e.g. `length=40 on line "base"`. */
  label: string;
  /** Global variable indices this constraint reads. */
  vars: number[];
  /** Residuals (mm-like units) of the local variables, in `vars` order. */
  eval(x: D[]): D[];
  /** Structural equations (an arc's ends on its circle) — never blamed alone. */
  structural?: boolean;
  /** Anything the caller wants back (source location, element...). */
  data?: unknown;
}

export interface System {
  /** Initial guess. */
  x0: Float64Array;
  constraints: Constraint[];
  /** Characteristic sketch size (mm), for tolerances and trust radius. */
  scale: number;
}

export interface Eval {
  F: Float64Array;
  /** Row-major m × n, or empty when not requested. */
  J: Float64Array;
  /** Constraint index of each row. */
  owner: Int32Array;
}

/** Residuals (and optionally the Jacobian) of the constraints `which` at `x`. */
export function evaluate(sys: System, x: Float64Array, which: number[], withJ: boolean): Eval {
  const n = x.length;
  const Fs: number[] = [];
  const owners: number[] = [];
  const rows: [number[], Float64Array][] = [];
  for (const ci of which) {
    const c = sys.constraints[ci]!;
    const k = c.vars.length;
    const local = c.vars.map((vi, i) => variable(x[vi]!, i, k));
    for (const r of c.eval(local)) {
      Fs.push(r.v);
      owners.push(ci);
      if (withJ) rows.push([c.vars, r.g]);
    }
  }
  const m = Fs.length;
  const J = new Float64Array(withJ ? m * n : 0);
  if (withJ) rows.forEach(([vars, g], r) => vars.forEach((vi, i) => (J[r * n + vi]! += g[i]!)));
  return { F: Float64Array.from(Fs), J, owner: Int32Array.from(owners) };
}

const maxAbs = (v: Float64Array) => v.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
const norm2 = (v: Float64Array) => Math.sqrt(v.reduce((a, b) => a + b * b, 0));

export interface SolveResult {
  x: Float64Array;
  F: Float64Array;
  owner: Int32Array;
  converged: boolean;
  /** Largest absolute residual. */
  residual: number;
  iterations: number;
}

/** Tolerance on the largest residual for a sketch of size `scale`. */
export function tolerance(scale: number): number {
  return 1e-10 * Math.max(1, scale);
}

/**
 * Minimise ½‖F‖² from `x0` over the constraints `which`. Steps are minimum-norm
 * (dx = −Jᵀ(JJᵀ + λI)⁻¹F), so variables the constraints don't pin stay where they were drawn.
 */
/**
 * `metric`: optional per-variable weights for the minimum-norm step (dx = −W²Jᵀ(JW²Jᵀ + λI)⁻¹F):
 * a small weight makes a variable expensive to move (a dragged point stays where it's put).
 */
export function lm(sys: System, which: number[], x0: Float64Array = sys.x0, maxIter = 200, metric?: Float64Array): SolveResult {
  const n = x0.length;
  let x = Float64Array.from(x0);
  const tol = tolerance(sys.scale);
  const trust = 2 * Math.max(1, sys.scale);
  let e = evaluate(sys, x, which, true);
  let cost = norm2(e.F);
  let lambda = 0;
  let it = 0;
  for (; it < maxIter; it++) {
    if (maxAbs(e.F) < tol * 1e-2) break;
    const m = e.F.length;
    if (m === 0) break;
    // A = J Jᵀ
    const A = new Float64Array(m * m);
    let diag = 0;
    for (let i = 0; i < m; i++)
      for (let j = 0; j <= i; j++) {
        let s = 0;
        if (metric) for (let k = 0; k < n; k++) s += e.J[i * n + k]! * e.J[j * n + k]! * metric[k]! * metric[k]!;
        else for (let k = 0; k < n; k++) s += e.J[i * n + k]! * e.J[j * n + k]!;
        A[i * m + j] = s;
        A[j * m + i] = s;
        if (i === j) diag = Math.max(diag, s);
      }
    const floor = 1e-13 * Math.max(diag, 1e-300);
    let accepted = false;
    for (let tries = 0; tries < 30; tries++) {
      const lam = Math.max(lambda, floor);
      const y = cholSolve(A, m, lam, e.F);
      if (!y) {
        lambda = Math.max(lam * 10, 1e-9 * diag);
        continue;
      }
      const dx = new Float64Array(n);
      for (let i = 0; i < m; i++) {
        const yi = y[i]!;
        if (yi === 0) continue;
        for (let k = 0; k < n; k++) dx[k]! -= e.J[i * n + k]! * yi * (metric ? metric[k]! * metric[k]! : 1);
      }
      const dn = norm2(dx);
      if (dn > trust) for (let k = 0; k < n; k++) dx[k]! *= trust / dn;
      const xn = new Float64Array(n);
      for (let k = 0; k < n; k++) xn[k] = x[k]! + dx[k]!;
      const en = evaluate(sys, xn, which, true);
      const cn = norm2(en.F);
      if (Number.isFinite(cn) && cn < cost) {
        x = xn;
        e = en;
        const gain = cost - cn;
        cost = cn;
        lambda = lambda / 10 < floor ? 0 : lambda / 10;
        accepted = true;
        // stalled on an inconsistent system: tiny relative gains
        if (gain < 1e-15 * Math.max(1, cost) && maxAbs(e.F) > tol) tries = 99;
        break;
      }
      lambda = Math.max(lam * 10, 1e-9 * diag);
      if (dn < 1e-15 * (1 + norm2(x))) break;
    }
    if (!accepted) break;
  }
  const residual = maxAbs(e.F);
  return { x, F: e.F, owner: e.owner, converged: residual < tol, residual, iterations: it };
}

/** Solve (A + λI) y = b by Cholesky; null if not positive definite. */
function cholSolve(A: Float64Array, m: number, lam: number, b: Float64Array): Float64Array | null {
  const L = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * m + j]! + (i === j ? lam : 0);
      for (let k = 0; k < j; k++) s -= L[i * m + k]! * L[j * m + k]!;
      if (i === j) {
        if (!(s > 0)) return null;
        L[i * m + i] = Math.sqrt(s);
      } else L[i * m + j] = s / L[j * m + j]!;
    }
  }
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i * m + k]! * y[k]!;
    y[i] = s / L[i * m + i]!;
  }
  for (let i = m - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < m; k++) s -= L[k * m + i]! * y[k]!;
    y[i] = s / L[i * m + i]!;
  }
  return y;
}

export interface Analysis {
  /** Rank of the Jacobian. */
  rank: number;
  /** Remaining degrees of freedom: variables − rank. */
  dof: number;
  /** Per variable, how free it is (0 = pinned, 1 = untouched by any constraint). */
  freedom: Float64Array;
  /** Constraints with an equation implied by earlier ones, and the constraints implying it. */
  redundant: { constraint: number; partners: number[] }[];
  /** Orthonormal basis of the Jacobian's row space (rank × variables). */
  basis: Float64Array[];
}

/** Rank, DOF, free variables and redundancy at a solution (modified Gram–Schmidt on rows). */
export function analyze(sys: System, x: Float64Array, which: number[]): Analysis {
  const n = x.length;
  const { J, owner } = evaluate(sys, x, which, true);
  const m = owner.length;
  const Q: Float64Array[] = [];
  /** Q[k] = Σ T[k][r] · row r (r over all rows, dense). */
  const T: Float64Array[] = [];
  const redundant = new Map<number, Set<number>>();
  for (let r = 0; r < m; r++) {
    const v = J.slice(r * n, (r + 1) * n);
    const rn = norm2(v);
    const t = new Float64Array(m);
    t[r] = 1;
    if (rn === 0) continue; // an equation that is constant here (degenerate); ignore
    for (let pass = 0; pass < 2; pass++)
      for (let k = 0; k < Q.length; k++) {
        const q = Q[k]!;
        let c = 0;
        for (let i = 0; i < n; i++) c += q[i]! * v[i]!;
        if (c === 0) continue;
        for (let i = 0; i < n; i++) v[i]! -= c * q[i]!;
        const tk = T[k]!;
        for (let i = 0; i < m; i++) t[i]! -= c * tk[i]!;
      }
    const vn = norm2(v);
    if (vn > 1e-8 * rn) {
      for (let i = 0; i < n; i++) v[i]! /= vn;
      for (let i = 0; i < m; i++) t[i]! /= vn;
      Q.push(v);
      T.push(t);
    } else {
      // row r ≈ Σ −t[i]·row i (i ≠ r): those rows' constraints imply it
      // (an equation implied only by its own constraint's other rows is not news)
      const own = owner[r]!;
      const set = redundant.get(own) ?? new Set<number>();
      const big = t.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
      for (let i = 0; i < m; i++) if (i !== r && Math.abs(t[i]!) > 1e-6 * big && owner[i] !== own) set.add(owner[i]!);
      if (set.size) redundant.set(own, set);
    }
  }
  const freedom = new Float64Array(n).fill(1);
  for (const q of Q) for (let i = 0; i < n; i++) freedom[i]! -= q[i]! * q[i]!;
  for (let i = 0; i < n; i++) freedom[i] = Math.max(0, freedom[i]!);
  return {
    rank: Q.length,
    dof: n - Q.length,
    freedom,
    redundant: [...redundant].map(([constraint, s]) => ({ constraint, partners: [...s].sort((a, b) => a - b) })),
    basis: Q,
  };
}

export interface Conflict {
  /** The constraint that can't be added to the ones before it. */
  culprit: number;
  /** The earlier constraints it fights with. */
  partners: number[];
  /** Largest residual left when solving up to and including the culprit. */
  residual: number;
}

/**
 * Find the first constraint (in order) that makes the system unsolvable from the guess, and
 * the constraints it conflicts with (those left with residuals at the least-squares optimum).
 */
export function findConflict(sys: System, order: number[]): Conflict | null {
  const ok = (k: number) => lm(sys, order.slice(0, k)).converged;
  if (ok(order.length)) return null;
  let lo = 0, hi = order.length; // ok(lo) true, ok(hi) false
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  const culprit = order[hi - 1]!;
  const r = lm(sys, order.slice(0, hi), sys.x0, 400);
  const tol = tolerance(sys.scale);
  const big = maxAbs(r.F);
  const partners = new Set<number>();
  r.F.forEach((f, i) => {
    const c = r.owner[i]!;
    if (c !== culprit && Math.abs(f) > Math.max(tol * 100, 1e-4 * big)) partners.add(c);
  });
  return { culprit, partners: [...partners].sort((a, b) => a - b), residual: r.residual };
}
