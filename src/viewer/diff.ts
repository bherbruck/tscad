/**
 * Geometry diff between two evaluations of a model: per part, what the new version adds
 * (new − old) and removes (old − new), as exact kernel booleans. Unchanged parts (identical IR)
 * cost nothing; the kernel's subtree cache makes the unchanged pieces of changed parts free.
 */
import type { Document, Node, Part } from "../ir";

/** How a part changed between two versions. */
export type DiffStatus = "changed" | "same" | "new" | "gone";

/** A part in a document diff. */
export interface DiffEntry {
  part: string;
  status: DiffStatus;
  /** Diff-document part names holding the added / removed solids. */
  added?: string;
  removed?: string;
}

const ADD = "__diff_add_";
const REM = "__diff_rem_";

/** The document to evaluate for a diff, and how its parts map back to the model's. */
export function diffDocument(before: Document, after: Document): { document: Document; entries: DiffEntry[] } {
  const old = new Map((before.parts ?? []).map((p) => [p.name ?? "", p]));
  const cur = new Map((after.parts ?? []).map((p) => [p.name ?? "", p]));
  const parts: Part[] = [];
  const entries: DiffEntry[] = [];
  let i = 0;
  const add = (prefix: string, node: Node): string => {
    const name = `${prefix}${i++}`;
    parts.push({ name, node });
    return name;
  };
  for (const [name, p] of cur) {
    const o = old.get(name);
    if (!o) {
      entries.push({ part: name, status: "new", added: add(ADD, p.node) });
      continue;
    }
    if (sameNode(o.node, p.node)) {
      entries.push({ part: name, status: "same" });
      continue;
    }
    entries.push({
      part: name,
      status: "changed",
      added: add(ADD, { type: "difference", children: [p.node, o.node] }),
      removed: add(REM, { type: "difference", children: [o.node, p.node] }),
    });
  }
  for (const [name, o] of old) if (!cur.has(name)) entries.push({ part: name, status: "gone", removed: add(REM, o.node) });
  return { document: { parts }, entries };
}

/** Structural equality of IR nodes (JSON, which is what the kernel's cache keys on too). */
export function sameNode(a: Node, b: Node): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

type Box = [[number, number, number], [number, number, number]];

/** The stats a part diff compares. */
export interface PartStats {
  volume?: number;
  bbox?: Box;
}

/** A part diff with the volumes added and removed. */
export interface DiffPartData {
  part: string;
  status: DiffStatus;
  /** mm³ of material the new version adds / removes. */
  addedVolume: number;
  removedVolume: number;
  /** Net change, mm³ (new − old volume). */
  deltaVolume: number;
  bboxBefore?: Box;
  bboxAfter?: Box;
  /** Change in size along x, y, z, mm. */
  deltaSize?: [number, number, number];
  error?: string;
}

/** Per-part numbers from the diff evaluation and the two versions' own stats. */
export function summarize(entries: DiffEntry[], results: Map<string, { ok: boolean; empty: boolean; volume?: number; error?: { message: string } }>, before: Map<string, PartStats>, after: Map<string, PartStats>): DiffPartData[] {
  const vol = (n?: string) => {
    if (!n) return 0;
    const r = results.get(n);
    return r && r.ok && !r.empty ? (r.volume ?? 0) : 0;
  };
  const err = (n?: string) => {
    const r = n ? results.get(n) : undefined;
    return r && !r.ok ? r.error?.message ?? "failed" : undefined;
  };
  return entries.map((e) => {
    const b = before.get(e.part), a = after.get(e.part);
    const size = (x?: Box) => (x ? [0, 1, 2].map((k) => x[1][k]! - x[0][k]!) : undefined);
    const sb = size(b?.bbox), sa = size(a?.bbox);
    return {
      part: e.part,
      status: e.status,
      addedVolume: vol(e.added),
      removedVolume: vol(e.removed),
      deltaVolume: (a?.volume ?? 0) - (b?.volume ?? 0),
      bboxBefore: b?.bbox,
      bboxAfter: a?.bbox,
      deltaSize: sa && sb ? ([sa[0]! - sb[0]!, sa[1]! - sb[1]!, sa[2]! - sb[2]!] as [number, number, number]) : undefined,
      ...(err(e.added) || err(e.removed) ? { error: err(e.added) ?? err(e.removed) } : {}),
    };
  });
}
