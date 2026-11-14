/**
 * A Model Context Protocol server (spec 2025-06-18) over stdio: newline-delimited JSON-RPC 2.0.
 * Hand-rolled: the protocol surface tscad needs (initialize, ping, tools/list, tools/call) is
 * small, and this keeps tscad free of the SDK's dependency tree.
 */
import pkg from "../../package.json" with { type: "json" };
import { TOOLS, ToolInputError, type ToolResult } from "./tools";

/** The MCP protocol version this server implements (older ones are accepted too). */
export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED = [PROTOCOL_VERSION, "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `tscad: parametric CAD as TSX (React-style JSX → exact B-rep solids, STEP/STL/3MF export).
Start with tscad_docs (the authoring guide; then {"element": ...} for exact props), look at an example with tscad_read_example, write the model TSX, check it with tscad_evaluate (errors point at TSX lines), tscad_render (PNG) and tscad_check (printability, interference), then tscad_export (or tscad_plate for a print-ready layout). Units are mm and degrees, Z up; <box>/<cylinder> sit centred on z = 0.`;

type Id = string | number;
interface Request {
  jsonrpc: "2.0";
  id?: Id | null;
  method: string;
  params?: any;
}
type Response = { jsonrpc: "2.0"; id: Id | null; result: unknown } | { jsonrpc: "2.0"; id: Id | null; error: { code: number; message: string; data?: unknown } };

const err = (id: Id | null, code: number, message: string, data?: unknown): Response => ({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

/** Handles MCP messages; transport-agnostic (one parsed JSON message in, a response or null out). */
export function createMcpHandler(opts: { log?: (msg: string) => void } = {}) {
  let initialized = false;
  return async function handle(msg: unknown): Promise<Response | null> {
    if (Array.isArray(msg)) return err(null, -32600, "JSON-RPC batches are not supported (MCP 2025-06-18)");
    const m = msg as Request;
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
      return err((m as any)?.id ?? null, -32600, "invalid request");
    }
    const isNotification = m.id === undefined || m.id === null;
    const id = (m.id ?? null) as Id | null;
    try {
      switch (m.method) {
        case "initialize": {
          const asked = m.params?.protocolVersion;
          initialized = true;
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: SUPPORTED.includes(asked) ? asked : PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "tscad", title: "tscad: CAD as TSX", version: pkg.version },
              instructions: INSTRUCTIONS,
            },
          };
        }
        case "notifications/initialized":
        case "notifications/cancelled":
          return null;
        case "ping":
          return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: { tools: TOOLS.map(({ run: _run, ...t }) => t) },
          };
        case "tools/call": {
          const name = m.params?.name;
          const tool = TOOLS.find((t) => t.name === name);
          if (!tool) return err(id, -32602, `unknown tool: ${String(name)}`);
          const args = m.params?.arguments ?? {};
          if (typeof args !== "object" || Array.isArray(args)) return err(id, -32602, "arguments must be an object");
          let result: ToolResult;
          try {
            result = await tool.run(args);
          } catch (e) {
            // tool failures are results with isError (the model can read and fix them)
            const message = e instanceof ToolInputError ? e.message : `${(e as Error)?.name ?? "Error"}: ${(e as Error)?.message ?? String(e)}`;
            if (!(e instanceof ToolInputError)) opts.log?.(`tool ${name} failed: ${(e as Error)?.stack ?? e}`);
            result = { content: [{ type: "text", text: message }], isError: true };
          }
          return isNotification ? null : { jsonrpc: "2.0", id, result };
        }
        default:
          if (m.method.startsWith("notifications/")) return null;
          if (!initialized && m.method !== "initialize") opts.log?.(`request ${m.method} before initialize`);
          return isNotification ? null : err(id, -32601, `method not found: ${m.method}`);
      }
    } catch (e) {
      opts.log?.(`internal error: ${(e as Error)?.stack ?? e}`);
      return isNotification ? null : err(id, -32603, (e as Error)?.message ?? "internal error");
    }
  };
}

/** Options for {@link runMcpServer}. */
export interface McpServerOptions {
  /** Incoming bytes/strings (default `process.stdin`). */
  stdin?: AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array>;
  /** Where responses go (default `process.stdout`). */
  stdout?: { write(chunk: string): unknown };
  /** Diagnostics (default: stderr). Never the protocol stream. */
  log?: (msg: string) => void;
}

/**
 * Serve MCP over stdio until stdin ends. While it runs on the real stdout, `console.log` & co.
 * are redirected to stderr so nothing but JSON-RPC reaches the client.
 */
export async function runMcpServer(opts: McpServerOptions = {}): Promise<void> {
  const out = opts.stdout ?? process.stdout;
  const log = opts.log ?? ((s: string) => process.stderr.write(`[tscad mcp] ${s}\n`));
  const restore: (() => void)[] = [];
  if (out === process.stdout) {
    const saved = { log: console.log, info: console.info, debug: console.debug };
    console.log = console.info = console.debug = (...a: unknown[]) => console.error(...a);
    restore.push(() => Object.assign(console, saved));
  }
  const handle = createMcpHandler({ log });
  const send = (r: Response | null) => {
    if (r) out.write(`${JSON.stringify(r)}\n`);
  };
  const pending = new Set<Promise<void>>();
  const onLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    let msg: unknown;
    try {
      msg = JSON.parse(t);
    } catch {
      send(err(null, -32700, "parse error"));
      return;
    }
    // requests run concurrently (tools serialise kernel access themselves)
    const p: Promise<void> = handle(msg).then(send, (e) => log(String(e))).finally(() => pending.delete(p));
    pending.add(p);
  };
  const input = opts.stdin ?? (process.stdin as unknown as AsyncIterable<Uint8Array>);
  const decoder = new TextDecoder();
  let buf = "";
  try {
    const iter: AsyncIterable<Uint8Array | string> = Symbol.asyncIterator in (input as object) ? (input as AsyncIterable<Uint8Array | string>) : streamIter(input as ReadableStream<Uint8Array>);
    for await (const chunk of iter) {
      buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    if (buf.trim()) onLine(buf);
    await Promise.all(pending);
  } finally {
    for (const r of restore) r();
  }
}

async function* streamIter(s: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = s.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}
