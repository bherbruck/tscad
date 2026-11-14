/**
 * Finds or starts one `tscad dev` server per workspace folder (no `vscode` import, so it is
 * unit-tested with bun). Servers it started are killed on dispose and also exit by themselves
 * when this process goes away (TSCAD_PARENT_PID).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunningServer {
  root: string;
  url: string;
  pid: number;
  /** Started by us (killed on dispose) or found already running (left alone). */
  owned: boolean;
  child?: ChildProcess;
}

/** Where `tscad dev --root <root>` advertises itself (same hash as src/cli/dev.ts). */
export function discoveryPath(root: string): string {
  return join(tmpdir(), `tscad-dev-${createHash("sha1").update(root).digest("hex").slice(0, 12)}.json`);
}

/**
 * The command that runs the tscad CLI for a workspace: the `tscad.command` setting, else the
 * workspace's own copy (`node_modules/tscad`, or the tscad repo itself), else `bunx tscad`.
 */
export function resolveCommand(root: string, setting?: string): string[] {
  if (setting?.trim()) return setting.trim().split(/\s+/);
  const installed = join(root, "node_modules/tscad/src/cli/index.ts");
  if (existsSync(installed)) return ["bun", installed];
  const repo = join(root, "src/cli/index.ts");
  try {
    if (existsSync(repo) && JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name === "tscad") return ["bun", repo];
  } catch {
    /* no package.json */
  }
  return ["bunx", "tscad"];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface ManagerOptions {
  command: (root: string) => string[];
  log?: (line: string) => void;
  /** Max wait for a server to come up, ms. */
  timeout?: number;
  env?: Record<string, string>;
}

export class ServerManager {
  #servers = new Map<string, Promise<RunningServer>>();

  constructor(readonly opts: ManagerOptions) {}

  /** The server for `root`, showing `file`: reused (ours or a running one) or started. */
  async get(root: string, file: string): Promise<RunningServer> {
    let p = this.#servers.get(root);
    if (p) {
      const s = await p.catch(() => undefined);
      if (s && (await this.#healthy(s))) {
        await this.setFile(s, file);
        return s;
      }
      this.#servers.delete(root);
    }
    p = this.#findOrStart(root, file);
    this.#servers.set(root, p);
    p.catch(() => this.#servers.delete(root));
    return p;
  }

  /** Servers currently known (started or adopted). */
  async list(): Promise<RunningServer[]> {
    const out: RunningServer[] = [];
    for (const p of this.#servers.values()) {
      const s = await p.catch(() => undefined);
      if (s) out.push(s);
    }
    return out;
  }

  async setFile(s: RunningServer, file: string): Promise<void> {
    const r = await fetch(`${s.url}/__model`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file }) });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `switching model failed (${r.status})`);
  }

  async #healthy(s: RunningServer): Promise<boolean> {
    if (!alive(s.pid)) return false;
    try {
      const r = await fetch(`${s.url}/__status`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async #findOrStart(root: string, file: string): Promise<RunningServer> {
    // A `tscad dev --root <root>` someone already runs: use it, don't own it.
    const disc = discoveryPath(root);
    if (existsSync(disc)) {
      try {
        const d = JSON.parse(readFileSync(disc, "utf8")) as { pid: number; url: string; root: string };
        const s: RunningServer = { root, url: d.url, pid: d.pid, owned: false };
        if (d.root === root && (await this.#healthy(s))) {
          await this.setFile(s, file);
          this.opts.log?.(`using the running tscad dev server at ${s.url} (pid ${s.pid})`);
          return s;
        }
      } catch {
        /* stale */
      }
    }
    return this.#start(root, file);
  }

  #start(root: string, file: string): Promise<RunningServer> {
    const [cmd, ...args] = this.opts.command(root);
    const argv = [...args, "dev", file, "--root", root, "--port", "0", "--diagnostics"];
    this.opts.log?.(`starting: ${cmd} ${argv.join(" ")}`);
    const child = spawn(cmd!, argv, {
      cwd: root,
      env: { ...process.env, ...this.opts.env, TSCAD_EDITOR: "1", TSCAD_PARENT_PID: String(process.pid), NO_COLOR: "1", TSCAD_SELF_RELOAD: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return new Promise<RunningServer>((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`tscad dev didn't start within ${(this.opts.timeout ?? 60_000) / 1000} s:\n${out.slice(-2000)}`));
      }, this.opts.timeout ?? 60_000);
      const onData = (b: Buffer) => {
        const text = b.toString();
        out += text;
        for (const line of text.split("\n")) {
          if (line.trim()) this.opts.log?.(line);
          const m = line.match(/^TSCAD_READY (.*)$/);
          if (m) {
            clearTimeout(timer);
            const info = JSON.parse(m[1]!) as { url: string; pid: number };
            resolve({ root, url: info.url, pid: info.pid, owned: true, child });
          }
        }
      };
      child.stdout!.on("data", onData);
      child.stderr!.on("data", onData);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`couldn't run ${cmd}: ${e.message} — install bun (https://bun.sh) or set "tscad.command"`));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        this.#servers.delete(root);
        reject(new Error(`tscad dev exited (${code}):\n${out.slice(-2000)}`));
      });
    });
  }

  /** Stop the servers we started (adopted ones keep running). */
  async dispose(): Promise<void> {
    const all = await this.list();
    this.#servers.clear();
    await Promise.all(
      all
        .filter((s) => s.owned && s.child && s.child.exitCode === null)
        .map(
          (s) =>
            new Promise<void>((done) => {
              const t = setTimeout(() => {
                s.child!.kill("SIGKILL");
                done();
              }, 3000);
              s.child!.once("exit", () => {
                clearTimeout(t);
                done();
              });
              s.child!.kill("SIGTERM");
            }),
        ),
    );
  }
}
