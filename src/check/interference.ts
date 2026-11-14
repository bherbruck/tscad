/**
 * Interference between the parts of a document: the volume each pair shares, from the kernel
 * (an `intersection` of the two part trees). Pairs whose bounding boxes don't overlap are
 * skipped.
 */
import type { Document, EvalOptions, Node, PartResult } from "../ir";
import type { KernelHost } from "../kernel/index";

export interface InterferencePair {
  a: string;
  b: string;
  /** Shared volume, mm³. */
  volume: number;
  /** Bounds of the shared region. */
  bbox?: [[number, number, number], [number, number, number]];
}

export interface InterferenceResult {
  /** No pair shares more than `minVolume`. */
  ok: boolean;
  /** Pairs that interfere, largest overlap first. */
  pairs: InterferencePair[];
  /** Pairs evaluated with the kernel (bounding boxes overlapped). */
  checked: number;
  /** Pairs skipped because their bounding boxes are apart. */
  skipped: number;
  /** Pairs whose intersection failed in the kernel. */
  errors: { a: string; b: string; message: string }[];
  millis: number;
}

export interface InterferenceOptions {
  /** Ignore overlaps smaller than this, mm³. Default 1e-3. */
  minVolume?: number;
  /** Re-evaluate `document` afterwards so the session's meshes are this model's again. Default true. */
  restore?: boolean;
  /** Evaluate options used for the restore (e.g. `{ noMesh: true }`). */
  evalOptions?: EvalOptions;
  /** Only these part names. */
  parts?: string[];
}

type Box = [[number, number, number], [number, number, number]];

function overlap(a: Box, b: Box, eps: number): boolean {
  for (let k = 0; k < 3; k++) if (a[0][k]! > b[1][k]! - eps || b[0][k]! > a[1][k]! - eps) return false;
  return true;
}

/**
 * Check every pair of parts in `document` for overlapping volume. Uses (and by default
 * restores) the kernel session; the session's subtree cache makes repeated checks cheap.
 */
export async function checkInterference(kernel: KernelHost, document: Document, opts: InterferenceOptions = {}): Promise<InterferenceResult> {
  const t0 = performance.now();
  const minVolume = opts.minVolume ?? 1e-3;
  const parts = (document.parts ?? []).filter((p) => !opts.parts || opts.parts.includes(p.name ?? ""));
  const first = await kernel.evaluate({ parts }, { noMesh: true });
  const byName = new Map<string, PartResult>(first.parts.map((p) => [p.name, p]));
  const jobs: { a: string; b: string; node: Node }[] = [];
  let skipped = 0;
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const A = parts[i]!, B = parts[j]!;
      const ra = byName.get(A.name ?? ""), rb = byName.get(B.name ?? "");
      if (!ra?.ok || !rb?.ok || !ra.bbox || !rb.bbox || ra.empty || rb.empty) {
        skipped++;
        continue;
      }
      const size = Math.max(...[0, 1, 2].map((k) => Math.max(ra.bbox![1][k]! - ra.bbox![0][k]!, rb.bbox![1][k]! - rb.bbox![0][k]!)));
      if (!overlap(ra.bbox, rb.bbox, size * 1e-9)) {
        skipped++;
        continue;
      }
      jobs.push({ a: A.name ?? "", b: B.name ?? "", node: { type: "intersection", children: [A.node, B.node] } });
    }
  const pairs: InterferencePair[] = [];
  const errors: InterferenceResult["errors"] = [];
  if (jobs.length) {
    const r = await kernel.evaluate({ parts: jobs.map((j, i) => ({ name: `__interference_${i}`, node: j.node })) }, { noMesh: true });
    r.parts.forEach((p, i) => {
      const j = jobs[i]!;
      if (!p.ok) errors.push({ a: j.a, b: j.b, message: p.error?.message ?? "failed" });
      else if (!p.empty && (p.volume ?? 0) > minVolume) pairs.push({ a: j.a, b: j.b, volume: p.volume!, ...(p.bbox ? { bbox: p.bbox } : {}) });
    });
  }
  if (opts.restore !== false) await kernel.evaluate(document, opts.evalOptions);
  pairs.sort((x, y) => y.volume - x.volume);
  return { ok: pairs.length === 0 && errors.length === 0, pairs, checked: jobs.length, skipped, errors, millis: performance.now() - t0 };
}
