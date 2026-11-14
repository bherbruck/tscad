/** The dev server's viewer page: the viewer app driven by the dev server's socket. */
import { mountViewer, type ViewerConfig } from "./app";

const config: Partial<ViewerConfig> = { ws: "/__ws", ...((window as any).__TSCAD__ ?? {}) };

// Inside an editor (the VS Code extension frames this page with ?embed=1): source clicks go to
// the editor, which reveals the range, instead of a toast.
if (new URLSearchParams(location.search).has("embed") && window.parent !== window) {
  config.onSourceClick = (loc, target) => {
    const t = target as any;
    window.parent.postMessage(
      { type: "tscad:reveal", loc, kind: target.kind, dimension: t.dimension ? { kind: t.dimension.kind, text: t.dimension.text } : undefined },
      "*",
    );
  };
  document.documentElement.classList.add("embedded");
}

// `tscad dev <folder>`: a way back to the gallery.
if ((config as any).gallery) {
  const back = document.createElement("a");
  back.href = (config as any).gallery;
  back.className = "btn";
  back.title = "All models in this folder";
  back.textContent = "← Gallery";
  config.topbarExtras = [back];
}

mountViewer(document.getElementById("app")!, config);
