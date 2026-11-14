/** Parameter sweeps for property-testing models across their params. */
import type { ParamSchema, ParamSpec, ParamValues } from "../core/params";
import { paramDefaults } from "../core/params";

/** Options for {@link paramCombos} / {@link forEachParamCombo}. */
export interface ComboOptions {
  /**
   * Numeric sampling: `"lhs"` (latin hypercube, default), `"random"`, `"corners"` (min/max of
   * every number), `"grid"` (`samples` levels per number — grows fast).
   */
  method?: "lhs" | "random" | "corners" | "grid";
  /** Numeric samples per discrete combination (lhs/random), or levels per number (grid). Default 4. */
  samples?: number;
  /** PRNG seed, for reproducible sweeps. Default 1. */
  seed?: number;
  /** Also include the all-defaults combo first. Default true. */
  defaults?: boolean;
  /** Cap on the number of combos (sampled evenly when exceeded). Default 64. */
  max?: number;
  /** Only vary these params (others stay at their defaults). */
  only?: string[];
  /** Fixed values that override sampling. */
  fixed?: Record<string, unknown>;
}

/** A small seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function numeric(s: ParamSpec): s is Extract<ParamSpec, { type: "number" | "int" }> {
  return (s.type === "number" || s.type === "int") && s.min !== undefined && s.max !== undefined && s.max > s.min;
}

function quantize(s: Extract<ParamSpec, { type: "number" | "int" }>, v: number): number {
  let x = Math.min(s.max!, Math.max(s.min!, v));
  if (s.step) x = s.min! + Math.round((x - s.min!) / s.step) * s.step;
  if (s.type === "int") x = Math.round(x);
  return Math.min(s.max!, Math.max(s.min!, +x.toPrecision(12)));
}

/**
 * Parameter combinations for a sweep: every combination of the choice/boolean params, each with
 * numeric params sampled across their `min`..`max` (latin hypercube by default). Numbers
 * without both bounds, text and colours stay at their defaults.
 *
 * @example test.each(paramCombos(params, { samples: 3 }))("evaluates with %o", async (p) => { ... })
 */
export function paramCombos<S extends ParamSchema>(schema: S, o: ComboOptions = {}): ParamValues<S>[] {
  const keys = Object.keys(schema).filter((k) => !o.only || o.only.includes(k));
  const nums = keys.filter((k) => numeric(schema[k]!) && !(o.fixed && k in o.fixed));
  const discrete = keys.filter((k) => (schema[k]!.type === "choice" || schema[k]!.type === "boolean") && !(o.fixed && k in o.fixed));
  const base = { ...paramDefaults(schema), ...(o.fixed ?? {}) } as Record<string, unknown>;
  // cartesian product of the discrete params
  let combos: Record<string, unknown>[] = [{}];
  for (const k of discrete) {
    const s = schema[k]!;
    const values: unknown[] = s.type === "boolean" ? [false, true] : [...(s as Extract<ParamSpec, { type: "choice" }>).options];
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
  }
  const rand = rng(o.seed ?? 1);
  const n = Math.max(1, Math.floor(o.samples ?? 4));
  const method = o.method ?? "lhs";
  const numericSets = (): Record<string, number>[] => {
    if (!nums.length) return [{}];
    const specs = nums.map((k) => schema[k] as Extract<ParamSpec, { type: "number" | "int" }>);
    if (method === "corners") {
      let sets: Record<string, number>[] = [{}];
      nums.forEach((k, i) => (sets = sets.flatMap((c) => [specs[i]!.min!, specs[i]!.max!].map((v) => ({ ...c, [k]: quantize(specs[i]!, v) })))));
      return sets;
    }
    if (method === "grid") {
      let sets: Record<string, number>[] = [{}];
      nums.forEach((k, i) => {
        const s = specs[i]!;
        const levels = Array.from({ length: n }, (_, j) => quantize(s, s.min! + ((s.max! - s.min!) * (n === 1 ? 0.5 : j / (n - 1)))));
        sets = sets.flatMap((c) => [...new Set(levels)].map((v) => ({ ...c, [k]: v })));
      });
      return sets;
    }
    // lhs / random
    const cols = specs.map((s) => {
      const u = Array.from({ length: n }, (_, j) => (method === "lhs" ? (j + rand()) / n : rand()));
      if (method === "lhs") for (let j = n - 1; j > 0; j--) {
        const r = Math.floor(rand() * (j + 1));
        [u[j], u[r]] = [u[r]!, u[j]!];
      }
      return u.map((x) => quantize(s, s.min! + x * (s.max! - s.min!)));
    });
    return Array.from({ length: n }, (_, j) => Object.fromEntries(nums.map((k, i) => [k, cols[i]![j]!])));
  };
  const out: Record<string, unknown>[] = [];
  if (o.defaults !== false) out.push({ ...base });
  for (const c of combos) for (const s of numericSets()) out.push({ ...base, ...c, ...s });
  // de-duplicate, cap
  const seen = new Set<string>();
  let uniq = out.filter((c) => {
    const k = JSON.stringify(c);
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const max = o.max ?? 64;
  if (uniq.length > max) {
    const head = o.defaults !== false ? [uniq[0]!] : [];
    const rest = uniq.slice(head.length);
    const step = rest.length / (max - head.length);
    uniq = [...head, ...Array.from({ length: max - head.length }, (_, i) => rest[Math.floor(i * step)]!)];
  }
  return uniq as ParamValues<S>[];
}

/** Run `fn` for every combo from {@link paramCombos}, sequentially. */
export async function forEachParamCombo<S extends ParamSchema>(
  schema: S,
  options: ComboOptions,
  fn: (values: ParamValues<S>, index: number) => unknown | Promise<unknown>,
): Promise<number> {
  const combos = paramCombos(schema, options);
  for (let i = 0; i < combos.length; i++) await fn(combos[i]!, i);
  return combos.length;
}
