// tscad docs: theme toggle (shared with the viewer: localStorage "tscad.theme"), copy buttons,
// mobile menu, and the active TOC entry.
(() => {
  const root = document.documentElement;
  const set = (t) => {
    root.dataset.theme = t;
    try { localStorage.setItem("tscad.theme", t); } catch {}
  };
  document.querySelectorAll("[data-theme-toggle]").forEach((b) =>
    b.addEventListener("click", () => set(root.dataset.theme === "light" ? "dark" : "light")),
  );
  const top = document.querySelector(".top");
  document.querySelector(".menu-btn")?.addEventListener("click", () => top.classList.toggle("open"));

  for (const pre of document.querySelectorAll("pre.code")) {
    const b = document.createElement("button");
    b.className = "copy";
    b.type = "button";
    b.textContent = "Copy";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector("code").innerText);
        b.textContent = "Copied";
      } catch {
        b.textContent = "Select + ⌘C";
      }
      setTimeout(() => (b.textContent = "Copy"), 1400);
    });
    pre.appendChild(b);
  }

  const links = [...document.querySelectorAll(".toc a")];
  if (links.length && "IntersectionObserver" in window) {
    const byId = new Map(links.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const visible = new Set();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
        const first = [...byId.keys()].find((id) => visible.has(id));
        if (first) links.forEach((a) => a.classList.toggle("active", a === byId.get(first)));
      },
      { rootMargin: "-70px 0px -65% 0px" },
    );
    for (const id of byId.keys()) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
  }
})();
