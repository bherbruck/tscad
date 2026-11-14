/**
 * tscad for VS Code: a live preview (the tscad viewer from a `tscad dev` server, one per
 * workspace folder) beside the editor, kernel/compile/sketch diagnostics, Preview/Export
 * CodeLens, and click-to-source from the viewer back into the editor.
 */
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { defaultExportLine, DIMENSION_PROPS, groupDiagnostics, isModel, revealSpan, type DiagnosticItem } from "./model";
import { resolveCommand, ServerManager, type RunningServer } from "./server";
import { previewHtml } from "./extension-html";
import { applyChanges } from "../../../src/core/sketch/drag";

let manager: ServerManager;
let output: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;
let preview: { panel: vscode.WebviewPanel; server: RunningServer; file: string } | undefined;
/** Diagnostics long-poll loops, one per server URL. */
const polling = new Map<string, { stop: boolean }>();

const config = () => vscode.workspace.getConfiguration("tscad");

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("tscad");
  diagnostics = vscode.languages.createDiagnosticCollection("tscad");
  manager = new ServerManager({ command: (root) => resolveCommand(root, config().get<string>("command")), log: (l) => output.appendLine(l) });

  context.subscriptions.push(
    output,
    diagnostics,
    vscode.commands.registerCommand("tscad.openPreview", (uri?: vscode.Uri) => openPreview(uri ?? vscode.window.activeTextEditor?.document.uri)),
    vscode.commands.registerCommand("tscad.export", (format?: string, uri?: vscode.Uri) => exportModel(format, uri ?? vscode.window.activeTextEditor?.document.uri)),
    vscode.commands.registerCommand("tscad.restartServer", async () => {
      stopPolling();
      await manager.dispose();
      preview?.panel.dispose();
      void vscode.window.showInformationMessage("tscad: dev server stopped; it starts again with the next preview.");
    }),
    vscode.languages.registerCodeLensProvider({ language: "typescriptreact" }, new ModelLenses()),
    vscode.window.onDidChangeActiveTextEditor((e) => e && onActiveDocument(e.document)),
    vscode.workspace.onDidOpenTextDocument((d) => maybeAutoOpen(d)),
  );
  const current = vscode.window.activeTextEditor?.document;
  if (current) maybeAutoOpen(current);
}

export async function deactivate() {
  stopPolling();
  await manager?.dispose();
}

function stopPolling() {
  for (const p of polling.values()) p.stop = true;
  polling.clear();
}

function isModelDoc(d: vscode.TextDocument): boolean {
  return d.languageId === "typescriptreact" && d.uri.scheme === "file" && isModel(d.getText());
}

const autoOpened = new Set<string>();
function maybeAutoOpen(d: vscode.TextDocument) {
  if (!config().get<boolean>("autoOpenPreview") || preview || !isModelDoc(d)) return;
  // Once per file per session: closing the preview means "not now".
  if (autoOpened.has(d.uri.fsPath)) return;
  autoOpened.add(d.uri.fsPath);
  void openPreview(d.uri, true);
}

async function onActiveDocument(d: vscode.TextDocument) {
  if (!preview || !config().get<boolean>("followActiveEditor") || !isModelDoc(d) || d.uri.fsPath === preview.file) return;
  const root = rootOf(d.uri);
  if (root !== preview.server.root) return void openPreview(d.uri, true);
  try {
    await manager.setFile(preview.server, d.uri.fsPath);
    preview.file = d.uri.fsPath;
    preview.panel.title = `Preview · ${basename(d.uri.fsPath)}`;
  } catch (e) {
    output.appendLine(String((e as Error).message));
  }
}

function rootOf(uri: vscode.Uri): string {
  return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? resolve(uri.fsPath, "..");
}

async function serverFor(uri: vscode.Uri): Promise<RunningServer> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "tscad: starting the dev server…" }, () => manager.get(rootOf(uri), uri.fsPath));
}

// ───────────────────────── preview ─────────────────────────

async function openPreview(uri: vscode.Uri | undefined, quiet = false) {
  if (!uri || !uri.fsPath.endsWith(".tsx")) {
    if (!quiet) void vscode.window.showWarningMessage("tscad: open a .tsx model to preview it.");
    return;
  }
  let server: RunningServer;
  try {
    server = await serverFor(uri);
  } catch (e) {
    output.appendLine(String((e as Error).message));
    void vscode.window.showErrorMessage(`tscad: ${String((e as Error).message).split("\n")[0]}`, "Show Log").then((a) => a && output.show());
    return;
  }
  startPolling(server);
  if (preview && preview.server === server) {
    preview.file = uri.fsPath;
    preview.panel.title = `Preview · ${basename(uri.fsPath)}`;
    preview.panel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }
  preview?.panel.dispose();
  const panel = vscode.window.createWebviewPanel("tscad.preview", `Preview · ${basename(uri.fsPath)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
  const external = await vscode.env.asExternalUri(vscode.Uri.parse(server.url));
  panel.webview.html = previewHtml(external.toString(true).replace(/\/$/, ""));
  panel.webview.onDidReceiveMessage((m) => {
    if (m?.type === "tscad:reveal" && m.loc) void reveal(server.root, m.loc, m.dimension?.kind, m.kind);
    if (m?.type === "tscad:edit" && Array.isArray(m.changes)) void applySketchEdits(server.root, m.changes);
  });
  panel.onDidDispose(() => {
    if (preview?.panel === panel) preview = undefined;
  });
  preview = { panel, server, file: uri.fsPath };
}

/** Select the source of a viewer click (dimension → its prop; sketch/mate/error → the element). */
async function reveal(root: string, loc: { file: string; line: number; column: number }, dimensionKind?: string, kind?: string) {
  const file = isAbsolute(loc.file) ? loc.file : resolve(root, loc.file);
  const doc = await vscode.workspace.openTextDocument(file);
  const props = dimensionKind ? DIMENSION_PROPS[dimensionKind] : kind === "mate" ? ["angle", "offset"] : undefined;
  const s = revealSpan(doc.getText(), loc.line, loc.column || 1, props);
  const range = new vscode.Range(s.startLine, s.startCol, s.endLine, s.endCol);
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: range, preserveFocus: false });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** A sketch drag dropped in the preview: edit the open documents (undoable) and save them. */
async function applySketchEdits(root: string, changes: any[]) {
  const byFile = new Map<string, any[]>();
  for (const c of changes) {
    const loc = c.kind === "addPoint" ? c.sketch : c.loc;
    if (!loc?.file) continue;
    const file = isAbsolute(loc.file) ? loc.file : resolve(root, loc.file);
    const local = { ...loc, file };
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(c.kind === "addPoint" ? { ...c, sketch: local } : { ...c, loc: local });
  }
  for (const [file, list] of byFile) {
    const doc = await vscode.workspace.openTextDocument(file);
    const r = applyChanges(doc.getText(), list);
    for (const f of r.refused) output.appendLine(`sketch edit refused: ${f.reason}`);
    if (!r.applied.length) continue;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), r.source);
    await vscode.workspace.applyEdit(edit);
    await doc.save(); // the dev server rebuilds from disk
  }
}

// ───────────────────────── diagnostics ─────────────────────────

function startPolling(server: RunningServer) {
  if (!config().get<boolean>("diagnostics") || polling.has(server.url)) return;
  const state = { stop: false };
  polling.set(server.url, state);
  let since = -1;
  let shown: string[] = [];
  void (async () => {
    while (!state.stop) {
      try {
        const r = await fetch(`${server.url}/__diagnostics?since=${since}`);
        const body = (await r.json()) as { items: DiagnosticItem[]; version: number };
        if (state.stop) break;
        since = body.version;
        const grouped = groupDiagnostics(body.items, (f) => {
          const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === f);
          if (open) return open.getText();
          try {
            return readFileSync(f, "utf8");
          } catch {
            return undefined;
          }
        });
        for (const f of shown) if (!grouped.has(f)) diagnostics.delete(vscode.Uri.file(f));
        for (const [f, list] of grouped) {
          diagnostics.set(
            vscode.Uri.file(f),
            list.map((d) => {
              const diag = new vscode.Diagnostic(
                new vscode.Range(d.startLine, d.startCol, d.endLine, d.endCol),
                d.message,
                d.severity === "error" ? vscode.DiagnosticSeverity.Error : d.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
              );
              diag.source = `tscad ${d.source}`;
              return diag;
            }),
          );
        }
        shown = [...grouped.keys()];
      } catch {
        // Server restarting or gone: back off.
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();
}

// ───────────────────────── CodeLens & export ─────────────────────────

class ModelLenses implements vscode.CodeLensProvider {
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!config().get<boolean>("codeLens") || !isModelDoc(doc)) return [];
    const line = defaultExportLine(doc.getText());
    if (line === undefined) return [];
    const range = new vscode.Range(line, 0, line, 0);
    return [
      new vscode.CodeLens(range, { title: "▶ Preview", command: "tscad.openPreview", arguments: [doc.uri] }),
      ...(["step", "stl", "3mf"] as const).map((f) => new vscode.CodeLens(range, { title: `Export ${f.toUpperCase()}`, command: "tscad.export", arguments: [f, doc.uri] })),
    ];
  }
}

async function exportModel(format: string | undefined, uri: vscode.Uri | undefined) {
  if (!uri) return;
  format ??= await vscode.window.showQuickPick(["step", "stl", "3mf", "glb", "obj", "dxf", "svg"], { placeHolder: "Export format" });
  if (!format) return;
  const server = await serverFor(uri).catch((e) => void vscode.window.showErrorMessage(`tscad: ${(e as Error).message.split("\n")[0]}`));
  if (!server) return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `tscad: exporting ${basename(uri.fsPath)} as ${format.toUpperCase()}…` }, async () => {
    const r = await fetch(`${server.url}/__export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format, file: uri.fsPath }) });
    const body = (await r.json()) as { path?: string; bytes?: number; error?: string };
    if (!r.ok || !body.path) {
      output.appendLine(body.error ?? `export failed (${r.status})`);
      void vscode.window.showErrorMessage(`tscad: export failed: ${(body.error ?? "").split("\n")[0]}`, "Show Log").then((a) => a && output.show());
      return;
    }
    const kb = ((body.bytes ?? 0) / 1024).toFixed(1);
    void vscode.window.showInformationMessage(`tscad: wrote ${basename(body.path)} (${kb} kB)`, "Reveal").then((a) => a && vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(body.path!)));
  });
}
