const HA_VARS: [string, string][] = [
  ["--c-bg", "--primary-background-color"],
  ["--c-card", "--card-background-color"],
  ["--c-text", "--primary-text-color"],
  ["--c-muted", "--secondary-text-color"],
  ["--c-border", "--divider-color"],
  ["--c-accent", "--primary-color"],
  ["--c-green", "--success-color"],
  ["--c-red", "--error-color"],
  ["--c-amber", "--warning-color"],
  ["--c-input", "--input-fill-color"],
];

function copyHaTheme(): boolean {
  const parentDoc = window.parent?.document;
  if (!parentDoc || window.parent === window) return false;
  const cs = getComputedStyle(parentDoc.documentElement);
  const bg = cs.getPropertyValue("--primary-background-color").trim();
  if (!bg) return false;
  const root = document.documentElement;
  for (const [ours, ha] of HA_VARS) {
    const v = cs.getPropertyValue(ha).trim();
    if (v) root.style.setProperty(ours, v);
  }
  const card = cs.getPropertyValue("--card-background-color").trim();
  if (!cs.getPropertyValue("--input-fill-color").trim()) {
    root.style.setProperty("--c-input", card || bg);
  }
  root.style.setProperty("--c-nav", bg);
  const text = cs.getPropertyValue("--primary-text-color").trim();
  if (text) {
    root.style.setProperty("--c-on-accent", "#fff");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", bg);
  return true;
}

export function startThemeSync() {
  const apply = () => {
    try {
      copyHaTheme();
    } catch {
      /* iframe de otro origen: queda prefers-color-scheme */
    }
  };
  apply();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
  try {
    if (window.parent && window.parent !== window) {
      const obs = new MutationObserver(apply);
      obs.observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    }
  } catch {
    /* ignore */
  }
}
