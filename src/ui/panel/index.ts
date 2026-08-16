import { createToggleButton, TOGGLE_ID } from "./toggleButton";
import { createPanel } from "./seedPanel";
import { installOpenHotkeyListener } from "./hotkey";
import { isSelectionOverlayOpen } from "../../services/seedDeleter";
import { onVersionCheck, startPeriodicVersionCheck, type VersionCheckResult } from "../../services/versionCheck";
import { setStyles } from "./dom";

declare const __MG_VERSION__: string;

const GATE_ID = "qws-seeddeleter-updategate";
const GITHUB_URL = "https://github.com/joshueke/MG-SeedDeleterMod";

function buildUpdateGateBanner(result: VersionCheckResult): HTMLDivElement {
  const banner = setStyles(document.createElement("div"), {
    position: "fixed",
    left: "50%",
    bottom: "16px",
    transform: "translateX(-50%)",
    zIndex: "999999",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    border: "1px solid #da3633",
    borderRadius: "10px",
    background: "rgba(22,27,34,0.97)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
    color: "#E7EEF7",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: "12px",
    maxWidth: "min(92vw, 460px)",
  } as any);
  banner.id = GATE_ID;

  const text = document.createElement("div");
  text.textContent = `⚠️ Seed Deleter v${result.current} is disabled — major update to v${result.latest} required.`;
  setStyles(text, { lineHeight: "1.4" });

  const link = document.createElement("a");
  link.href = GITHUB_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Update →";
  setStyles(link, {
    flexShrink: "0", fontWeight: "700", color: "#58a6ff", textDecoration: "underline", whiteSpace: "nowrap",
  } as any);

  banner.append(text, link);
  return banner;
}

function mountNow() {
  if (document.getElementById(TOGGLE_ID)) return;

  let openToggle = () => {};
  const toggle = createToggleButton(() => openToggle());

  const { panel, setVisible } = createPanel({ setMode: toggle.setMode, getMode: toggle.getMode });
  let forceUpdateActive = false;
  openToggle = () => {
    if (forceUpdateActive) return;
    setVisible(panel.style.display === "none");
  };

  installOpenHotkeyListener(() => {
    if (isSelectionOverlayOpen()) return;
    openToggle();
  });

  document.body.appendChild(toggle.btn);
  document.body.appendChild(panel);

  onVersionCheck((result) => {
    forceUpdateActive = result.status === "update-required";
    toggle.btn.style.display = forceUpdateActive ? "none" : "flex";
    if (forceUpdateActive) setVisible(false);

    const existingBanner = document.getElementById(GATE_ID);
    if (forceUpdateActive) {
      if (!existingBanner) document.body.appendChild(buildUpdateGateBanner(result));
    } else {
      existingBanner?.remove();
    }
  });
}

export function mountSeedDeleterUI() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountNow, { once: true });
  } else {
    mountNow();
  }
  startPeriodicVersionCheck(__MG_VERSION__);
}
