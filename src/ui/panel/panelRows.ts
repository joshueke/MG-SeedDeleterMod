import { setStyles } from "./dom";

function createHint(hint?: string): HTMLElement | null {
  if (!hint) return null;
  const el = document.createElement("div");
  el.textContent = hint;
  setStyles(el, { fontSize: "11px", fontWeight: "400", opacity: "0.6", marginTop: "2px" });
  return el;
}

export function createRow(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const row = setStyles(document.createElement("div"), {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    border: "1px solid #2b3340",
    borderRadius: "8px",
    background: "#0f1318",
  });
  const textCol = document.createElement("div");
  const text = document.createElement("div");
  text.textContent = label;
  setStyles(text, { fontSize: "12px", fontWeight: "600", opacity: "0.85" });
  textCol.appendChild(text);
  const hintEl = createHint(hint);
  if (hintEl) textCol.appendChild(hintEl);
  const controls = setStyles(document.createElement("div"), {
    display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end",
  });
  controls.appendChild(control);
  row.append(textCol, controls);
  return row;
}

export function createVerticalRow(
  label: string,
  control: HTMLElement,
  hint?: string,
  opts?: { stretch?: boolean }
): HTMLElement {
  const stretch = !!opts?.stretch;
  const row = setStyles(document.createElement("div"), {
    display: "flex",
    alignItems: stretch ? "stretch" : "center",
    flexDirection: "column",
    gap: "5px",
    padding: "8px 10px",
    border: "1px solid #2b3340",
    borderRadius: "8px",
    background: "#0f1318",
  });
  const text = document.createElement("div");
  text.textContent = label;
  setStyles(text, { fontSize: "12px", fontWeight: "600", opacity: "0.85", display: "flex", justifyContent: "center" });
  row.appendChild(text);
  const hintEl = createHint(hint);
  if (hintEl) {
    setStyles(hintEl, { marginTop: "-3px", textAlign: "center" } as any);
    row.appendChild(hintEl);
  }
  const controls = setStyles(document.createElement("div"), {
    display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: stretch ? "stretch" : "flex-end",
    ...(stretch ? { width: "100%" } : {}),
  } as any);
  controls.appendChild(control);
  row.append(controls);
  return row;
}

export function createSectionTitle(label: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  setStyles(el, {
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    opacity: "0.5",
    margin: "4px 2px -2px",
  } as any);
  return el;
}
