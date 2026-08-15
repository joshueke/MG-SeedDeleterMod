import { setStyles } from "./dom";
import { makeDraggable, loadPosition } from "./dragPosition";

export const TOGGLE_ID = "qws-seeddeleter-toggle";

const TOGGLE_POSITION_KEY = "mgSeedDeleter.togglePosition.v1";
const TOGGLE_MODE_KEY = "mgSeedDeleter.toggleMode.v1";

export type ToggleMode = "draggable" | "fixed";
const TOGGLE_FIXED_LEFT_PX = 90;
const TOGGLE_FIXED_BOTTOM_PX = 10;

function loadToggleMode(): ToggleMode {
  try {
    const stored = localStorage.getItem(TOGGLE_MODE_KEY);
    if (stored === "draggable" || stored === "fixed") return stored;
  } catch {}
  return "fixed";
}
function saveToggleMode(mode: ToggleMode): void {
  try { localStorage.setItem(TOGGLE_MODE_KEY, mode); } catch {}
}

export interface ToggleButtonController {
  btn: HTMLButtonElement;
  setMode: (mode: ToggleMode) => void;
  getMode: () => ToggleMode;
}

export function createToggleButton(onToggle: () => void): ToggleButtonController {
  const btn = document.createElement("button");
  btn.id = TOGGLE_ID;
  btn.textContent = "🌱";
  btn.title = "Seed deleter";
  setStyles(btn, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "999998",
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    borderRadius: "8px",
    border: "1px solid #39424c",
    background: "rgba(22,27,34,0.92)",
    color: "#E7EEF7",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: "16px",
    fontWeight: "700",
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  } as any);
  const dragController = makeDraggable(btn, btn, TOGGLE_POSITION_KEY);
  btn.onclick = onToggle;

  let currentMode: ToggleMode = loadToggleMode();
  btn.onmouseenter = () => {
    if (currentMode === "fixed") {
      btn.style.borderColor = "rgba(167, 139, 250, .35)";
      btn.style.background = "linear-gradient(rgba(167, 139, 250, .16), rgba(167, 139, 250, .16)), var(--gc-raised, #121219)";
    } else {
      btn.style.borderColor = "#6aa1";
    }
  };
  btn.onmouseleave = () => {
    if (currentMode === "fixed") {
      btn.style.borderColor = "transparent";
      btn.style.background = "#121219";
    } else {
      btn.style.borderColor = "#39424c";
    }
  };

  const setMode = (mode: ToggleMode) => {
    currentMode = mode;
    dragController.setEnabled(mode === "draggable");
    if (mode === "fixed") {
      setStyles(btn, {
        left: `${TOGGLE_FIXED_LEFT_PX}px`,
        bottom: `${TOGGLE_FIXED_BOTTOM_PX}px`,
        top: "auto",
        right: "auto",
        border: "1px solid transparent",
        boxShadow: "none",
        background: "#121219",
      });
    } else {
      setStyles(btn, {
        border: "1px solid #39424c",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        background: "rgba(22,27,34,0.92)",
      });
      if (!loadPosition(TOGGLE_POSITION_KEY)) {
        setStyles(btn, { left: "auto", top: "auto", right: "16px", bottom: "16px" });
      }
    }
    saveToggleMode(mode);
  };
  setMode(currentMode);

  return { btn, setMode, getMode: () => currentMode };
}
