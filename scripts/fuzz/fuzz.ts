/**
 * Kernel fuzzer: random IR trees → solidcore, checked by oracles, bugs delta-minimized.
 *
 *   bun scripts/fuzz/fuzz.ts [--minutes 25] [--workers 6] [--seed 1] [--replay <seed>]
 *
 * Oracles: panic; evaluation error on a boolean/primitive/sweep (valid input must evaluate);
 * bad volume (≤ 0 or NaN); mesh volume ≠ kernel volume (> 2%); open (non-watertight) mesh;
 * mesh failure / evaluation warnings; boolean volume identities; > 30 s evaluations.
 * Feature errors (fillet/chamfer/shell) are tallied as refusals, not bugs.
 * Output: fuzz/findings/<id>.json, fuzz/stats.json, docs/FUZZ.md.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Node } from "../../src/ir";
import { makeCase, setGenOptions, type Case } from "./gen";
import type { EvalReply } from "./worker";

const root = join(import.meta.dir, "..", "..");
const argv = process.argv.slice(2);
const arg = (k: string, d: number) => {
  const i = argv.indexOf(k);
  return i >= 0 ? Number(argv[i + 1]) : d;
};
const MINUTES = arg("--minutes", 25);
const WORKERS = arg("--workers", 6);
const SEED0 = arg("--seed", 1);
const REPLAY = argv.includes("--replay") ? arg("--replay", 0) : undefined;
const REPLAY_FINDINGS = argv.includes("--replay-findings");
const BIAS = (() => {
  const i = argv.indexOf("--bias");
  return i >= 0 ? argv[i + 1] ?? "" : "";
})();
if (BIAS.includes("no-torus")) setGenOptions({ torus: false });
const SLOW_MS = 30_000;
const HARD_MS = 120_000;
const MESH_TOL = 0.02;
const ID_TOL = 2e-3;
const FEATURES = new Set(["fillet", "chamfer", "shell"]);
const NOTES = "<!-- notes: hand-written, kept across runs -->";

// ---------------------------------------------------------------------------------------------
// worker pool

type Reply = EvalReply | { id: number; status: "timeout"; millis: number };

class Slot {
  worker!: Worker;
  ready!: Promise<void>;
  seq = 0;
  constructor() {
    this.spawn();
  }
  spawn() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url).href);
    this.ready = new Promise((res) => {
      const h = (e: MessageEvent) => {
        if (e.data?.ready) {
          this.worker.removeEventListener("message", h);
          res();
        }
      };
      this.worker.addEventListener("message", h);
    });
  }
  async eval(node: Node, mesh: boolean): Promise<Reply> {
    await this.ready;
    const id = ++this.seq;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.worker.removeEventListener("message", h);
        this.worker.terminate();
        this.spawn();
        resolve({ id, status: "timeout", millis: performance.now() - t0 });
      }, HARD_MS);
      const h = (e: MessageEvent<EvalReply>) => {
        if (e.data?.id !== id) return;
        clearTimeout(timer);
        this.worker.removeEventListener("message", h);
        resolve(e.data);
      };
      this.worker.addEventListener("message", h);
      this.worker.postMessage({ id, node, mesh });
    });
  }
}

// ---------------------------------------------------------------------------------------------
// oracles

interface Verdict {
  /** null = fine */
  oracle: string | null;
  op?: string;
  message?: string;
  detail?: string;
  refusal?: string;
  millis: number;
  slow?: boolean;
  empty?: boolean;
  /** For identity cases: the one tree (A, B, A∪B, …) that failed on its own. */
  failing?: Node;
}

const norm = (s = "") => s.replace(/0x[0-9a-f]+/gi, "#").replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#").replace(/\s+/g, " ").slice(0, 160);

function nodeAt(node: Node, path?: string): Node | undefined {
  if (!path) return undefined;
  const idx = path.split("/").slice(2).map(Number);
  let n: any = node;
  for (const i of idx) n = n?.children?.[i];
  return n;
}

function judgeSingle(node: Node, r: Reply): Verdict {
  const v: Verdict = { oracle: null, millis: r.millis };
  if (r.millis > SLOW_MS) v.slow = true;
  if (r.status === "timeout") return { ...v, oracle: "hang", op: node.type, message: `no answer in ${HARD_MS / 1000} s` };
  const rr = r as EvalReply;
  if (rr.status === "panic") return { ...v, oracle: "panic", op: rr.op ?? nodeAt(node, rr.path)?.type ?? node.type, message: rr.message };
  if (rr.status === "throw") return { ...v, oracle: "throw", op: node.type, message: rr.message };
  if (rr.status === "error") {
    const op = rr.op ?? nodeAt(node, rr.path)?.type ?? "?";
    if (FEATURES.has(op)) return { ...v, refusal: `${op}: ${norm(rr.message)}` };
    // a draft that closes the walls is bad input, not a kernel failure
    if (op === "extrude" && (nodeAt(node, rr.path) as any)?.draft) return { ...v, refusal: `extrude (draft): ${norm(rr.message)}` };
    return { ...v, oracle: "eval-error", op, message: rr.message };
  }
  if (rr.status === "empty") return { ...v, empty: true };
  const vol = rr.volume!;
  if (!(vol > 0) || !Number.isFinite(vol)) return { ...v, oracle: "bad-volume", op: node.type, message: `volume ${vol}` };
  if (rr.meshError) return { ...v, oracle: "mesh-error", op: "meshAt", message: rr.meshError };
  if (rr.warnings?.length) return { ...v, oracle: "warning", op: node.type, message: rr.warnings.join("; ") };
  if (rr.openEdges !== undefined && rr.openEdges > 0) return { ...v, oracle: "open-mesh", op: node.type, message: `mesh has open edges`, detail: `${rr.openEdges} open edges of ${rr.triangles} triangles` };
  if (rr.meshVolume !== undefined && Math.abs(rr.meshVolume - vol) / vol > MESH_TOL)
    return { ...v, oracle: "mesh-volume", op: node.type, message: `mesh volume differs from kernel volume`, detail: `kernel ${vol.toFixed(4)}, mesh ${rr.meshVolume.toFixed(4)} (${((100 * (rr.meshVolume - vol)) / vol).toFixed(2)}%)` };
  return v;
}

async function judge(slot: Slot, c: Case): Promise<Verdict> {
  if (c.kind === "single") {
    const r = await slot.eval(c.node!, true);
    const v = judgeSingle(c.node!, r);
    if (!v.oracle && v.slow) return { ...v, oracle: "slow", op: c.node!.type, message: `evaluation took > ${SLOW_MS / 1000} s`, detail: `${(v.millis / 1000).toFixed(1)} s` };
    return v;
  }
  const a = c.a!, b = c.b!;
  const nodes: [string, Node][] = [
    ["A", a],
    ["B", b],
    ["union", { type: "union", children: [a, b] }],
    ["intersection", { type: "intersection", children: [a, b] }],
    ["difference", { type: "difference", children: [a, b] }],
  ];
  const vol: Record<string, number> = {};
  let millis = 0;
  for (const [name, n] of nodes) {
    const r = await slot.eval(n, name !== "A" && name !== "B");
    millis += r.millis;
    const v = judgeSingle(n, r);
    if (v.oracle) return { ...v, detail: `${name}${v.detail ? `: ${v.detail}` : ""}`, failing: n };
    if (v.refusal) return { ...v, millis };
    vol[name] = v.empty ? 0 : (r as EvalReply).volume!;
  }
  const scale = Math.max(vol.A!, vol.B!, 1e-9);
  const e1 = vol.union! + vol.intersection! - vol.A! - vol.B!;
  const e2 = vol.difference! - (vol.A! - vol.intersection!);
  const show = Object.entries(vol).map(([k, x]) => `${k}=${x.toFixed(4)}`).join(" ");
  if (Math.abs(e1) / scale > ID_TOL) return { oracle: "identity-union", op: "union", message: "vol(A∪B) + vol(A∩B) ≠ vol(A) + vol(B)", detail: `${show} (off by ${((100 * e1) / scale).toFixed(2)}%)`, millis };
  if (Math.abs(e2) / scale > ID_TOL) return { oracle: "identity-difference", op: "difference", message: "vol(A−B) ≠ vol(A) − vol(A∩B)", detail: `${show} (off by ${((100 * e2) / scale).toFixed(2)}%)`, millis };
  return { oracle: null, millis };
}

const signature = (v: Verdict) => `${v.oracle}|${v.op}|${norm(v.message)}`;

// ---------------------------------------------------------------------------------------------
// delta minimization

type Edit = (n: Node) => Node;

function* subtreePaths(n: Node, path: number[] = []): Generator<[number[], Node]> {
  yield [path, n];
  const ch = (n as any).children as Node[] | undefined;
  if (ch) for (let i = 0; i < ch.length; i++) yield* subtreePaths(ch[i]!, [...path, i]);
}
function replaceAt(n: Node, path: number[], f: (x: Node) => Node): Node {
  if (!path.length) return f(n);
  const ch = [...((n as any).children as Node[])];
  ch[path[0]!] = replaceAt(ch[path[0]!]!, path.slice(1), f);
  return { ...(n as any), children: ch };
}
function roundNumbers(x: any, digits: number, skip = new Set<string>()): any {
  if (typeof x === "number") return digits < 0 ? x : +x.toFixed(digits);
  if (Array.isArray(x)) return x.map((v) => roundNumbers(v, digits, skip));
  if (x && typeof x === "object") {
    const o: any = {};
    for (const [k, v] of Object.entries(x)) o[k] = k === "children" || skip.has(k) ? v : roundNumbers(v, digits, skip);
    return o;
  }
  return x;
}

/** Candidate simplifications of `n`, biggest first. */
function candidates(n: Node): Node[] {
  const out: Node[] = [];
  const all = [...subtreePaths(n)];
  for (const [p, s] of all) {
    const ch = (s as any).children as Node[] | undefined;
    if (ch) for (const c of ch) out.push(replaceAt(n, p, () => c)); // hoist a child
    if (ch && ch.length > 2) for (let i = 0; i < ch.length; i++) out.push(replaceAt(n, p, (x: any) => ({ ...x, children: ch.filter((_, j) => j !== i) })));
  }
  for (const [p, s] of all) {
    if (s.type === "transform") {
      const m = s.matrix;
      out.push(replaceAt(n, p, (x: any) => ({ ...x, matrix: [m[0], m[1], m[2], 0, m[4], m[5], m[6], 0, m[8], m[9], m[10], 0, 0, 0, 0, 1] })));
      out.push(replaceAt(n, p, (x: any) => ({ ...x, matrix: [1, 0, 0, Math.round(m[3]), 0, 1, 0, Math.round(m[7]), 0, 0, 1, Math.round(m[11]), 0, 0, 0, 1] })));
    }
    if ((s as any).edges && (s as any).edges.type !== "all") out.push(replaceAt(n, p, (x: any) => ({ ...x, edges: { type: "all" } })));
    for (const d of [0, 1]) {
      const r = replaceAt(n, p, (x: any) => roundNumbers(x, d, new Set(["start", "end", "angle", "draft", "matrix"])));
      out.push(r);
    }
  }
  const len = JSON.stringify(n).length;
  return out.filter((c) => JSON.stringify(c).length < len || JSON.stringify(c) !== JSON.stringify(n)).filter((c) => JSON.stringify(c) !== JSON.stringify(n));
}

async function minimize(slot: Slot, c: Case, sig: string, budgetMs: number): Promise<{ min: Case; evals: number }> {
  const t0 = performance.now();
  let best = c;
  let evals = 0;
  const size = (k: Case) => JSON.stringify(k.kind === "single" ? k.node : [k.a, k.b]).length;
  let progress = true;
  while (progress && performance.now() - t0 < budgetMs) {
    progress = false;
    const cands: Case[] =
      best.kind === "single"
        ? candidates(best.node!).map((n) => ({ ...best, node: n }))
        : [...candidates(best.a!).map((a) => ({ ...best, a })), ...candidates(best.b!).map((b) => ({ ...best, b }))];
    cands.sort((x, y) => size(x) - size(y));
    for (const k of cands) {
      if (performance.now() - t0 > budgetMs) break;
      if (size(k) > size(best)) continue;
      evals++;
      const v = await judge(slot, k);
      if (v.oracle && signature(v) === sig) {
        best = k;
        progress = true;
        break;
      }
    }
  }
  // An identity finding whose operands are now plain may reduce to a single tree: keep as is.
  return { min: best, evals };
}

// ---------------------------------------------------------------------------------------------
// bookkeeping

interface Finding {
  id: string;
  oracle: string;
  op: string;
  message: string;
  detail?: string;
  count: number;
  seeds: number[];
  mode?: string;
  original: Case;
  minimal?: Case;
  minimalDetail?: string;
  minimizeEvals?: number;
  millis: number;
  signature: string;
  /** From `--replay-findings`: does the minimal repro still fail on the current wasm? */
  status?: "still failing" | "fixed" | "changed" | "unchecked";
  statusDetail?: string;
  checked?: string;
}

const findings = new Map<string, Finding>();
const refusals = new Map<string, number>();
const stats = { started: new Date().toISOString(), cases: 0, ok: 0, empty: 0, refused: 0, bugs: 0, slow: 0, identity: 0, newFindings: 0, evalMillis: [] as number[], workers: WORKERS, seed0: SEED0, minutes: MINUTES, bias: BIAS || "none" };
type RunStats = Omit<typeof stats, "evalMillis"> & { p50?: number; p90?: number; p99?: number; max?: number };
/** Earlier campaigns (from fuzz/stats.json). */
let pastRuns: RunStats[] = [];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 6);
}

const findingsDir = join(root, "fuzz", "findings");
mkdirSync(findingsDir, { recursive: true });

function save(f: Finding) {
  writeFileSync(join(findingsDir, `${f.id}.json`), JSON.stringify(
    {
      id: f.id,
      oracle: f.oracle,
      op: f.op,
      message: f.message,
      detail: f.detail,
      minimalDetail: f.minimalDetail,
      count: f.count,
      seeds: f.seeds,
      mode: f.mode,
      signature: f.signature,
      status: f.status,
      statusDetail: f.statusDetail,
      checked: f.checked,
      replay: `bun scripts/fuzz/fuzz.ts --replay ${f.seeds[0]}`,
      minimal: f.minimal ? docOf(f.minimal) : undefined,
      original: docOf(f.original),
    },
    null,
    2,
  ));
}
function caseOf(doc: any, seed: number): Case {
  if (doc.identity) return { seed, kind: "identity", a: doc.parts[0].node, b: doc.parts[1].node };
  return { seed, kind: "single", node: doc.parts[0].node };
}

/** Load every saved finding (so campaigns accumulate and dedupe against earlier ones). */
function loadState() {
  try {
    const st = JSON.parse(readFileSync(join(root, "fuzz", "stats.json"), "utf8"));
    pastRuns = st.runs ?? (st.started ? [{ ...st, refusals: undefined, findings: undefined, evalMillis: undefined }] : []);
    for (const [k, n] of Object.entries(st.refusals ?? {})) refusals.set(k, n as number);
  } catch {}
  for (const file of readdirSync(findingsDir).filter((f) => f.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(findingsDir, file), "utf8"));
    const sig = j.signature ?? `${j.oracle}|${j.op}|${norm(j.message)}`;
    findings.set(sig, {
      id: j.id, oracle: j.oracle, op: j.op, message: j.message, detail: j.detail, minimalDetail: j.minimalDetail,
      count: j.count, seeds: j.seeds, mode: j.mode, original: caseOf(j.original, j.seeds[0]), minimal: j.minimal ? caseOf(j.minimal, j.seeds[0]) : undefined,
      millis: 0, signature: sig, status: j.status, statusDetail: j.statusDetail, checked: j.checked,
    });
  }
}

function docOf(c: Case) {
  if (c.kind === "single") return { parts: [{ name: "f", node: c.node }] };
  return { identity: true, parts: [{ name: "A", node: c.a }, { name: "B", node: c.b }] };
}

function writeReport(final: boolean) {
  const sorted = [...findings.values()].sort((a, b) => b.count - a.count);
  const ms = [...stats.evalMillis].sort((a, b) => a - b);
  const pct = (q: number) => (ms.length ? (ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]! / 1000).toFixed(2) : "–");
  const { evalMillis: _ms, ...rest } = stats;
  const current: RunStats | undefined = stats.cases ? { ...rest, p50: +pct(0.5) || 0, p90: +pct(0.9) || 0, p99: +pct(0.99) || 0, max: +pct(1) || 0 } : undefined;
  const runs = [...pastRuns, ...(current ? [current] : [])];
  writeFileSync(join(root, "fuzz", "stats.json"), JSON.stringify({ runs, refusals: Object.fromEntries(refusals), findings: sorted.map((f) => ({ id: f.id, oracle: f.oracle, op: f.op, count: f.count, status: f.status ?? "unchecked" })) }, null, 2));
  const L: string[] = [];
  L.push("# Kernel fuzzing", "");
  L.push("`scripts/fuzz/fuzz.ts` generates seeded random IR trees (primitives with random sizes and rigid/mirrored placements; booleans arranged to overlap, touch, share planes, contain, coincide, nearly coincide or be tangent; extrudes of star polygons, rounded rectangles and circles, with draft; revolves; lofts; fillets/chamfers with random selectors and radii; shells), evaluates them on solidcore in worker sessions and checks:", "");
  L.push("| Oracle | Bug when |", "|---|---|");
  L.push("| `panic` | the kernel panics (wasm trap) |", "| `eval-error` | a boolean, primitive, sweep or transform fails — the generator only makes valid input |", "| `bad-volume` | `ok` but volume ≤ 0 or NaN |", "| `mesh-volume` | divergence-theorem volume of the export mesh differs from the kernel's by > 2% |", "| `open-mesh` | the export mesh is not closed (an edge not shared by exactly two triangles after welding) |", "| `mesh-error` / `warning` | meshing fails, or evaluation reports warnings |", "| `identity-union` / `identity-difference` | vol(A∪B)+vol(A∩B) ≠ vol(A)+vol(B), or vol(A−B) ≠ vol(A)−vol(A∩B) (0.2%) |", "| `slow` / `hang` | one evaluation takes > 30 s / > 120 s |", "");
  L.push("Fillet/chamfer/shell errors are counted as **refusals** (often legitimate: radius too large) and tallied below. Every bug is delta-minimized (hoist children, drop operands, simplify transforms, selectors and numbers) while it keeps the same (oracle, op, message) signature, and deduplicated by that signature.", "");
  L.push("Run a campaign: `bun scripts/fuzz/fuzz.ts --minutes 25 --workers 8 --seed 1 [--bias no-torus]` (findings accumulate across campaigns and are deduplicated against earlier ones). Replay one case: `--replay <seed>`. Re-check every saved minimal repro against the current wasm: `--replay-findings` (fills the Status column and writes `fuzz/regressions.json`). Findings: `fuzz/findings/<id>.json` (minimal + original IR, seeds).", "");
  L.push("## Campaigns", "", "| Started (UTC) | Seed | Workers | Bias | Cases | Identity checks | Clean | Empty | Refusals | Bug hits | New findings | Eval p50 / p99 / max |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of runs) L.push(`| ${r.started.slice(0, 16).replace("T", " ")}${r === current && !final ? " (running)" : ""} | ${r.seed0} | ${r.workers} | ${r.bias ?? "none"} | ${r.cases} | ${r.identity} | ${r.ok} | ${r.empty} | ${r.refused} | ${r.bugs} | ${r.newFindings ?? "–"} | ${r.p50 ?? "–"} / ${r.p99 ?? "–"} / ${r.max ?? "–"} s |`);
  const by = (st: string) => sorted.filter((f) => (f.status ?? "unchecked") === st).length;
  L.push("", `**${findings.size} distinct findings**: ${by("still failing")} still failing, ${by("fixed")} fixed, ${by("changed")} changed, ${by("unchecked")} not re-checked yet (status from the last \`--replay-findings\`).`, "");
  L.push("## Findings", "");
  L.push("| # | Status | Oracle | Op | Count | Message | Minimal repro |", "|---|---|---|---|---|---|---|");
  sorted.forEach((f, i) => {
    const min = f.minimal ? docOf(f.minimal) : docOf(f.original);
    const json = JSON.stringify(min.parts.length === 1 ? min.parts[0]!.node : { A: min.parts[0]!.node, B: min.parts[1]!.node });
    const msg = `${f.message}${f.minimalDetail ?? f.detail ? ` — ${f.minimalDetail ?? f.detail}` : ""}`.replace(/\|/g, "\\|").replace(/\n/g, " ");
    const status = f.status === "fixed" ? "✅ fixed" : f.status === "changed" ? `⚠️ changed: ${(f.statusDetail ?? "").replace(/\|/g, "\\|").slice(0, 160)}` : f.status === "still failing" ? "❌ failing" : "–";
    L.push(`| ${i + 1} | ${status} | \`${f.oracle}\` | ${f.op} | ${f.count} | ${msg} | [${f.id}](../fuzz/findings/${f.id}.json): \`${json.length > 900 ? json.slice(0, 900) + "…" : json}\` |`);
  });
  if (!sorted.length) L.push("| – | – | – | – | – | none | – |");
  L.push("", "## Refusals (fillet / chamfer / shell errors)", "", "| Count | Message |", "|---|---|");
  for (const [m, n] of [...refusals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) L.push(`| ${n} | ${m.replace(/\|/g, "\\|")} |`);
  L.push("");
  // keep hand-written triage notes (everything from the marker on) across runs
  const out = join(root, "docs", "FUZZ.md");
  let notes = "";
  try {
    const old = readFileSync(out, "utf8");
    const i = old.indexOf(NOTES);
    if (i >= 0) notes = old.slice(i);
  } catch {}
  writeFileSync(out, L.join("\n") + (notes ? `\n${notes}` : ""));
}

// ---------------------------------------------------------------------------------------------
// main

if (REPLAY !== undefined) {
  const slot = new Slot();
  const c = makeCase(REPLAY);
  console.log(JSON.stringify(docOf(c)));
  console.log(await judge(slot, c));
  process.exit(0);
}

loadState();

if (REPLAY_FINDINGS) {
  const list = [...findings.values()];
  const slots = Array.from({ length: Math.min(WORKERS, list.length) }, () => new Slot());
  const regressions: object[] = [];
  let next = 0;
  await Promise.all(
    slots.map(async (slot) => {
      while (next < list.length) {
        const f = list[next++]!;
        const c = f.minimal ?? f.original;
        const v = await judge(slot, c);
        const before = f.status;
        if (!v.oracle) {
          f.status = "fixed";
          f.statusDetail = v.refusal ? `now a refusal: ${v.refusal}` : v.empty ? "evaluates (empty result)" : "evaluates cleanly";
        } else if (signature(v) === f.signature) {
          f.status = "still failing";
          f.statusDetail = `${v.message ?? ""}${v.detail ? ` — ${v.detail}` : ""}`;
        } else {
          f.status = "changed";
          f.statusDetail = `${v.oracle}/${v.op}: ${v.message ?? ""}${v.detail ? ` — ${v.detail}` : ""}`;
        }
        f.checked = new Date().toISOString();
        save(f);
        if (f.status !== "fixed")
          regressions.push({
            id: f.id,
            oracle: v.oracle,
            op: v.op,
            message: v.message,
            detail: v.detail,
            originalOracle: f.oracle,
            expect: expectation(f.oracle),
            ir: docOf(c),
          });
        console.log(`${f.status.padEnd(13)} ${f.id}${before && before !== f.status ? ` (was ${before})` : ""}: ${f.statusDetail?.slice(0, 120)}`);
      }
    }),
  );
  regressions.sort((a: any, b: any) => a.id.localeCompare(b.id));
  writeFileSync(
    join(root, "fuzz", "regressions.json"),
    JSON.stringify({ about: "Minimal IR repros of solidcore bugs found by scripts/fuzz/fuzz.ts that still fail on the current wasm. Evaluate each `ir` document (Engine::evaluate); `expect` says what correct behaviour is, `oracle`/`message` what happens today. Identity entries hold parts A and B: evaluate A, B, union(A,B), intersection(A,B) and difference(A,B) and check the volume identities.", checked: new Date().toISOString(), count: regressions.length, regressions }, null, 2),
  );
  writeReport(true);
  process.exit(0);
}

function expectation(oracle: string): string {
  switch (oracle) {
    case "panic":
      return "evaluates without panicking";
    case "eval-error":
      return "evaluates ok (valid input)";
    case "bad-volume":
      return "ok with a positive, finite volume";
    case "mesh-volume":
      return "export mesh volume within 2% of the kernel volume";
    case "open-mesh":
      return "export mesh is closed (every edge shared by exactly two triangles)";
    case "mesh-error":
      return "meshAt succeeds";
    case "warning":
      return "evaluates with no warnings (a record is built)";
    case "identity-union":
      return "vol(A∪B) + vol(A∩B) = vol(A) + vol(B) within 0.2%";
    case "identity-difference":
      return "vol(A−B) = vol(A) − vol(A∩B) within 0.2%";
    default:
      return "evaluates ok";
  }
}

const deadline = performance.now() + MINUTES * 60_000;
let nextSeed = SEED0;
let lastReport = 0;

async function run(slot: Slot) {
  while (performance.now() < deadline) {
    const seed = nextSeed++;
    const c = makeCase(seed);
    let v: Verdict;
    try {
      v = await judge(slot, c);
    } catch (e) {
      v = { oracle: "throw", op: "?", message: String(e), millis: 0 };
    }
    stats.cases++;
    if (c.kind === "identity") stats.identity++;
    stats.evalMillis.push(v.millis);
    if (v.slow) stats.slow++;
    if (v.refusal) {
      stats.refused++;
      refusals.set(v.refusal, (refusals.get(v.refusal) ?? 0) + 1);
    } else if (!v.oracle) v.empty ? stats.empty++ : stats.ok++;
    else {
      stats.bugs++;
      const sig = signature(v);
      let f = findings.get(sig);
      if (f) {
        f.count++;
        if (f.seeds.length < 8) f.seeds.push(seed);
        save(f);
      } else {
        f = { id: `${v.oracle}-${v.op}-${hash(sig)}`, oracle: v.oracle, op: v.op ?? "?", message: v.message ?? "", detail: v.detail, count: 1, seeds: [seed], mode: c.mode, original: c, millis: v.millis, signature: sig, status: "unchecked" };
        stats.newFindings++;
        findings.set(sig, f);
        save(f);
        console.log(`[${stats.cases}] NEW ${f.id}: ${f.message.slice(0, 120)} (seed ${seed})`);
        if (v.oracle !== "slow" && v.oracle !== "hang") {
          // an identity case where one tree fails by itself: minimize that tree alone
          let start: Case = c;
          if (v.failing) {
            const single: Case = { seed, kind: "single", node: v.failing };
            const sv = await judge(slot, single);
            if (sv.oracle && signature(sv) === sig) start = single;
          }
          const { min, evals } = await minimize(slot, start, sig, 4 * 60_000);
          f.minimal = min;
          f.minimizeEvals = evals;
          const mv = await judge(slot, min);
          f.minimalDetail = mv.detail;
          save(f);
          console.log(`    minimized in ${evals} evals: ${JSON.stringify(docOf(min)).length} bytes`);
        }
      }
    }
    if (performance.now() - lastReport > 60_000) {
      lastReport = performance.now();
      writeReport(false);
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${stats.cases} cases, ${findings.size} findings, ${stats.refused} refusals`);
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, () => run(new Slot())));
writeReport(true);
console.log(`done: ${stats.cases} cases, ${findings.size} distinct findings`);
process.exit(0);
