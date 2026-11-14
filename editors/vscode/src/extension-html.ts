/** The preview webview's HTML (no `vscode` import, so it is unit-tested). */

/** The webview: the dev server's viewer in an iframe; source clicks are relayed to the extension. */
export function previewHtml(url: string): string {
  const origin = new URL(url).origin;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden;background:#0a0c11}</style>
</head><body>
<iframe src="${url}/?embed=1" allow="clipboard-write"></iframe>
<script>
  const vscode = acquireVsCodeApi();
  window.addEventListener("message", (e) => {
    if (e.origin === ${JSON.stringify(origin)} && e.data && (e.data.type === "tscad:reveal" || e.data.type === "tscad:edit")) vscode.postMessage(e.data);
  });
</script>
</body></html>`;
}

