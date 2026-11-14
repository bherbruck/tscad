/** `tscad init [dir]`: scaffold a model project. */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { c, sym } from "./ui";
import pkg from "../../package.json" with { type: "json" };

export const STARTER = `import { defineParams, edges, type ParamValues } from "tscad"

/** Everything here becomes a slider, toggle or dropdown in \`tscad dev\`. */
export const params = defineParams({
  width: { type: "number", default: 64, min: 30, max: 160, step: 1, unit: "mm", group: "Plate" },
  depth: { type: "number", default: 40, min: 20, max: 120, step: 1, unit: "mm", group: "Plate" },
  thickness: { type: "number", default: 5, min: 2, max: 12, step: 0.5, unit: "mm", group: "Plate" },
  corner: { type: "number", default: 6, min: 0, max: 15, step: 0.5, unit: "mm", label: "Corner radius", group: "Plate" },
  holes: { type: "boolean", default: true, label: "Mounting holes", group: "Holes" },
  holeDiameter: { type: "number", default: 4.2, min: 2, max: 8, step: 0.1, unit: "mm", label: "Hole Ø", group: "Holes" },
  inset: { type: "number", default: 8, min: 5, max: 20, step: 0.5, unit: "mm", group: "Holes" },
  edge: { type: "number", default: 1, min: 0, max: 2, step: 0.1, unit: "mm", label: "Top fillet", group: "Finish" },
  material: { type: "choice", default: "petg", options: ["pla", "petg", "aluminum"], group: "Finish" },
})

export default function MountingPlate(p: ParamValues<typeof params>) {
  const dx = p.width / 2 - p.inset
  const dy = p.depth / 2 - p.inset
  return (
    <part name="plate" material={p.material}>
      {/* Click an edge in the viewer to get a selector you can paste here. */}
      <fillet radius={p.edge} edges={edges.top()}>
        <difference>
          <extrude height={p.thickness}>
            <roundedRect w={p.width} h={p.depth} r={p.corner} center />
          </extrude>
          {p.holes &&
            [[-dx, -dy], [dx, -dy], [-dx, dy], [dx, dy]].map(([x, y]) => (
              <cylinder d={p.holeDiameter} h={p.thickness + 2} x={x} y={y} z={-1} />
            ))}
        </difference>
      </fillet>
    </part>
  )
}
`;

/** The files of a new project named `name`, by relative path. */
export function files(name: string): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      {
        name,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: { dev: "tscad dev index.tsx", build: "tscad build index.tsx -o out/model.stl -o out/model.step", info: "tscad info index.tsx" },
        dependencies: { tscad: `^${pkg.version}` },
      },
      null,
      2,
    ) + "\n",
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          jsxImportSource: "tscad",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ["bun-types"],
        },
        include: ["**/*.ts", "**/*.tsx"],
      },
      null,
      2,
    ) + "\n",
    "index.tsx": STARTER,
    ".gitignore": "node_modules/\nout/\n.tscad/\n*.stl\n*.step\n*.3mf\n*.glb\n.DS_Store\n",
    "README.md": `# ${name}\n\nA parametric model made with [tscad](https://github.com/bherbruck/tscad) — CAD as TSX.\n\n\`\`\`sh\nbun install\nbun run dev     # live viewer at http://localhost:3333\nbun run build   # out/model.stl + out/model.step\n\`\`\`\n`,
  };
}

/** Returns the exit code. */
export function init(dir = ".", opts: { force?: boolean } = {}): number {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  const name = basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+/, "") || "tscad-model";
  const toWrite = files(name);
  const clashes = Object.keys(toWrite).filter((f) => existsSync(join(root, f)));
  if (clashes.length && !opts.force) {
    console.error(`${sym.err} ${clashes.map((f) => c.bold(f)).join(", ")} already exist${clashes.length === 1 ? "s" : ""} in ${root} ${c.gray("(use --force to overwrite)")}`);
    return 1;
  }
  const wasEmpty = !existsSync(root) || readdirSync(root).length === 0;
  for (const [f, body] of Object.entries(toWrite)) {
    writeFileSync(join(root, f), body);
    console.log(`  ${c.green("+")} ${f}`);
  }
  const rel = relative(process.cwd(), root);
  console.log(`\n${sym.ok} Created ${c.bold(name)}${wasEmpty ? "" : " (in an existing directory)"}. Next:\n`);
  if (rel) console.log(`  ${c.gray("$")} cd ${rel}`);
  console.log(`  ${c.gray("$")} bun install`);
  console.log(`  ${c.gray("$")} ${c.accent("bunx tscad dev")}      ${c.gray("# live viewer with hot reload")}`);
  console.log(`  ${c.gray("$")} bunx tscad build -o model.stl\n`);
  return 0;
}
