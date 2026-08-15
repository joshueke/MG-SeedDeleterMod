import { createToggleButton, TOGGLE_ID } from "./toggleButton";
import { createPanel } from "./seedPanel";

function mountNow() {
  if (document.getElementById(TOGGLE_ID)) return;

  let openToggle = () => {};
  const toggle = createToggleButton(() => openToggle());

  const { panel, setVisible } = createPanel({ setMode: toggle.setMode, getMode: toggle.getMode });
  openToggle = () => setVisible(panel.style.display === "none");

  document.body.appendChild(toggle.btn);
  document.body.appendChild(panel);
}

export function mountSeedDeleterUI() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountNow, { once: true });
  } else {
    mountNow();
  }
}
