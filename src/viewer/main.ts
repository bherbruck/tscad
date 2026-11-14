/** The dev server's viewer page: the viewer app driven by the dev server's socket. */
import { mountViewer } from "./app";

mountViewer(document.getElementById("app")!, { ws: "/__ws", ...((window as any).__TSCAD__ ?? {}) });
