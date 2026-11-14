// Bundle the extension for VS Code's node runtime: bun build.ts → dist/extension.js
const r = await Bun.build({
  entrypoints: [`${import.meta.dir}/src/extension.ts`],
  outdir: `${import.meta.dir}/dist`,
  target: "node",
  format: "cjs",
  external: ["vscode"],
  minify: !process.argv.includes("--dev"),
  sourcemap: "linked",
});
if (!r.success) {
  for (const l of r.logs) console.error(l);
  process.exit(1);
}
for (const o of r.outputs) console.log(`${o.path.replace(import.meta.dir + "/", "")}  ${(o.size / 1024).toFixed(1)} kB`);
