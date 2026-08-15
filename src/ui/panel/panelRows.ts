import { setStyles } from "./dom";

export function createRow(label: string, control: HTMLElement): HTMLElement {
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
  const text = document.createElement("div");
  text.textContent = label;
  setStyles(text, { fontSize: "12px", fontWeight: "600", opacity: "0.85" });
  const controls = setStyles(document.createElement("div"), {
    display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end",
  });
  controls.appendChild(control);
  row.append(text, controls);
  return row;
}

export function createVerticalRow(label: string, control: HTMLElement): HTMLElement {
  const row = setStyles(document.createElement("div"), {
    display: "flex",
    alignItems: "center",
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
  const controls = setStyles(document.createElement("div"), {
    display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end",
  });
  controls.appendChild(control);
  row.append(text, controls);
  return row;
}
