#!/usr/bin/env bun
/** The `tscad` command line: init, dev, build, info. */
import { existsSync } from "node:fs";
import { parseArgs, parseParams, list, str, type Parsed } from "./args";
import { c, logo, sym, fmtMs } from "./ui";
import pkg from "../../package.json" with { type: "json" };

const HELP = `
${logo()} ${c.gray(`v${pkg.version}`)} — CAD as TSX

${c.bold("Usage")}
  ${c.accent("tscad init")} ${c.gray("[dir]")}                 scaffold a model project
  ${c.accent("tscad dev")} ${c.gray("[file]")}                 live viewer with hot reload
  ${c.accent("tscad build")} ${c.gray("[file] -o out.step")}   export STEP/STL/3MF/GLB/OBJ/DXF/SVG
  ${c.accent("tscad info")} ${c.gray("[file]")}                params and part stats
  ${c.accent("tscad render")} ${c.gray("[file] -o out.png")}   a PNG of the model
  ${c.accent("tscad convert")} ${c.gray("in.scad")}            OpenSCAD → tscad TSX
  ${c.accent("tscad mcp")}                         MCP server for AI agents
  ${c.gray("[file] defaults to index.tsx")}

${c.bold("dev")}
  --port <n>            port ${c.gray("(default 3333, or the next free one)")}
  --host <h>            interface ${c.gray("(default localhost)")}
  --open                open the browser
  --browser-eval        evaluate in the page (wasm), not in the server
  --root <dir>          make paths relative to this folder
  --diagnostics         evaluate on change; problems at /__diagnostics

${c.bold("build")}
  -o, --out <file>      output; extension = format ${c.gray("(repeat; default <name>.stl)")}
  -f, --format <fmt>    format when -o has no extension
  -p, --param <k=v>     override a parameter ${c.gray("(repeat, or a=1,b=2)")}
  -t, --tolerance <mm>  mesh chord tolerance ${c.gray("(default 0.01)")}
  --part <name>         only this part ${c.gray("(repeat)")}
  --section-z <mm>      .dxf/.svg without <drawing>s: cut at this Z
  --ascii               ASCII STL
  --json                machine-readable output

${c.bold("render")}
  -o, --out <file.png>  output ${c.gray("(default <name>.png)")}
  --view <v>            iso front back top bottom right left, or az,el
  --width, --height     pixels ${c.gray("(default 1200 × 800)")}
  --background <bg>     dark | light | transparent | <css colour>
  --ortho, --no-edges   orthographic; hide edge lines

${c.bold("convert")}
  -o, --out <file.tsx>  output ${c.gray("(default next to the .scad; - for stdout)")}
  --name <Component>    component name ${c.gray("(default from the file name)")}

${c.bold("Examples")}
  ${c.gray("$")} tscad dev bracket.tsx --open
  ${c.gray("$")} tscad build bracket.tsx -o bracket.step -o bracket.stl -p width=80
`;

export async function main(argv: string[]): Promise<number> {
  let args: Parsed;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`${sym.err} ${(e as Error).message}`);
    return 2;
  }
  const f = args.flags;
  if (f.version) {
    console.log(pkg.version);
    return 0;
  }
  if (f.help || !args.command) {
    if (!args.command && args.positionals.length) {
      console.error(`${sym.err} unknown command ${c.bold(args.positionals[0]!)}`);
      console.log(HELP);
      return 2;
    }
    console.log(HELP);
    return 0;
  }
  if (args.unknown.length) {
    console.error(`${sym.err} unknown option${args.unknown.length > 1 ? "s" : ""} ${args.unknown.join(", ")} ${c.gray("(tscad --help)")}`);
    return 2;
  }
  let params: Record<string, unknown>;
  try {
    params = parseParams(list(f.param));
  } catch (e) {
    console.error(`${sym.err} ${(e as Error).message}`);
    return 2;
  }
  const file = args.positionals[0] ?? "index.tsx";
  const needFile = () => {
    if (existsSync(file)) return true;
    console.error(`${sym.err} no model at ${c.bold(file)} ${c.gray(args.positionals[0] ? "" : "(pass a file, or run `tscad init` first)")}`);
    return false;
  };

  switch (args.command) {
    case "init": {
      const { init } = await import("./init");
      return init(args.positionals[0], { force: !!f.force });
    }
    case "build": {
      if (!needFile()) return 1;
      const tol = str(f.tolerance);
      if (tol !== undefined && !(Number(tol) > 0)) {
        console.error(`${sym.err} --tolerance must be a positive number of mm`);
        return 2;
      }
      const { build } = await import("./build");
      const sz = str(f["section-z"]);
      if (sz !== undefined && !Number.isFinite(Number(sz))) {
        console.error(`${sym.err} --section-z must be a number (mm)`);
        return 2;
      }
      return build({ file, outputs: list(f.out), params, tolerance: tol ? Number(tol) : undefined, parts: list(f.part), format: str(f.format), ascii: !!f.ascii, json: !!f.json, quiet: !!f.quiet, sectionZ: sz === undefined ? undefined : Number(sz) });
    }
    case "info": {
      if (!needFile()) return 1;
      const { info } = await import("./build");
      return info({ file, params, json: !!f.json });
    }
    case "render": {
      if (!needFile()) return 1;
      const { render } = await import("./render");
      const num = (v: unknown) => (str(v) === undefined ? undefined : Number(str(v)));
      return render({ file, out: str(f.out), params, view: str(f.view), width: num(f.width), height: num(f.height), background: str(f.background), ortho: !!f.ortho, edges: f.edges !== false });
    }
    case "convert": {
      const src = args.positionals[0];
      if (!src || !existsSync(src)) {
        console.error(`${sym.err} ${src ? `no such file: ${c.bold(src)}` : "usage: tscad convert in.scad [-o out.tsx]"}`);
        return src ? 1 : 2;
      }
      const { convert } = await import("./convert");
      return convert({ file: src, out: str(f.out), name: str(f.name), force: !!f.force });
    }
    case "mcp": {
      // stdout is the JSON-RPC stream: print nothing else.
      const { runMcpServer } = await import("../mcp");
      await runMcpServer();
      return 0;
    }
    case "dev": {
      if (!needFile()) return 1;
      return dev(file, f);
    }
  }
  return 0;
}

async function dev(file: string, f: Parsed["flags"]): Promise<number> {
  const { startDev } = await import("./dev");
  const t = performance.now();
  const wanted = Number(str(f.port) ?? process.env.PORT ?? 3333);
  let server;
  for (let port = wanted, tries = 0; ; port++, tries++) {
    try {
      server = await startDev({
        file,
        port,
        host: str(f.host),
        evaluate: f["browser-eval"] ? "browser" : f["server-eval"] ? "server" : "auto",
        root: str(f.root),
        diagnostics: !!f.diagnostics,
        onBuild: (e) => {
          const time = new Date().toLocaleTimeString([], { hour12: false });
          if (e.ok) console.log(`${c.gray(time)} ${sym.ok} bundled ${c.bold(file)} ${c.gray(`in ${fmtMs(e.millis)}`)}${e.version > 1 ? c.gray(` · reload #${e.version - 1}`) : ""}`);
          else {
            console.log(`${c.gray(time)} ${sym.err} ${c.red("build failed")}`);
            for (const m of e.errors) console.log(`  ${m.file ? c.cyan(`${m.file}:${m.line}:${m.column}`) + " " : ""}${m.message}${m.lineText ? `\n    ${c.gray(m.lineText)}` : ""}`);
          }
        },
      });
      break;
    } catch (e: any) {
      const inUse = e?.code === "EADDRINUSE" || /in use|EADDRINUSE/i.test(String(e?.message));
      if (!inUse || tries > 20 || str(f.port)) {
        console.error(`${sym.err} ${e?.message ?? e}`);
        return 1;
      }
    }
  }
  console.log(`\n  ${logo()} ${c.gray(`v${pkg.version}`)}  ${c.gray(`ready in ${fmtMs(performance.now() - t)}`)}\n`);
  const kernel =
    server.evalMode === "server"
      ? `${server.nativeKernel ? "native" : "wasm"}, in this process ${c.gray("(--browser-eval: in the page)")}`
      : server.nativeKernel
        ? `wasm, in the browser ${c.gray("(--browser-eval)")}`
        : `wasm, in the browser ${c.gray(`(no native kernel for ${process.platform}-${process.arch})`)}`;
  const arrow = c.gray(sym.arrow.includes("➜") ? "➜" : "->");
  console.log(`  ${sym.arrow}  ${c.bold("Viewer")}  ${c.accent(c.underline(server.url))}`);
  console.log(`  ${arrow}  ${c.gray("Model")}   ${file}`);
  console.log(`  ${arrow}  ${c.gray("Kernel")}  ${kernel}`);
  console.log(`  ${arrow}  ${c.gray("Stop")}    ${c.bold("Ctrl+C")}\n`);
  if (f.open) openBrowser(server.url);
  // Editor integrations: a machine-readable ready line, and exit when the editor goes away.
  if (process.env.TSCAD_EDITOR) console.log(`TSCAD_READY ${JSON.stringify({ url: server.url, pid: process.pid, evalMode: server.evalMode })}`);
  const parent = Number(process.env.TSCAD_PARENT_PID);
  if (parent > 0) {
    setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        void server.stop().finally(() => process.exit(0));
      }
    }, 1000).unref();
  }
  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
  return 0;
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* no browser */
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
