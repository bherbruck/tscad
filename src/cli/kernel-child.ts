/**
 * A kernel process for parallel evaluation (see parallel.ts). The native kernel serialises every
 * op behind one process-global lock, so parallelism needs processes, not threads. Speaks a tiny
 * request/reply protocol over Bun's IPC (structured clone, so typed arrays travel as is).
 */
import { createKernel, KernelPanic } from "../kernel";
import { LocalEvaluator } from "../viewer/pool";

const ev = createKernel().then((k) => new LocalEvaluator(k));

process.on("message", async (m: { id: number; op: string; args: any[] }) => {
  try {
    const e = await ev;
    let value: unknown;
    if (m.op === "evaluate") {
      const r = await e.evaluate(m.args[0], m.args[1]);
      value = { result: r.result, meshes: [...r.meshes] };
    } else if (m.op === "pick") value = await e.pick(m.args[0], m.args[1], m.args[2]);
    else if (m.op === "meshAt") value = await e.meshAt(m.args[0], m.args[1]);
    else if (m.op === "step") value = await e.step(m.args[0]);
    else if (m.op === "ping") value = e.kernel.version;
    else throw new Error(`unknown op ${m.op}`);
    process.send!({ id: m.id, ok: true, value });
  } catch (err: any) {
    process.send!({ id: m.id, ok: false, error: String(err?.message ?? err), panic: err instanceof KernelPanic });
  }
});

// The parent went away: don't linger.
process.on("disconnect", () => process.exit(0));
