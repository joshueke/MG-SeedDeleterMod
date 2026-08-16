import { SeedDeleterService, DEFAULT_SEED_DELETE_DELAY_MS, createButton } from "../../services/seedDeleter";
import { formatNum, EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS, formatDurationShort, formatFinishTime } from "../../utils/format";
import { setStyles } from "./dom";
import { makeDraggable, restoreSavedPosition } from "./dragPosition";
import { createRow, createVerticalRow, createSectionTitle } from "./panelRows";
import { createHotkeyPicker } from "./hotkey";
import type { ToggleMode } from "./toggleButton";
import { checkForUpdates, onVersionCheck, REPO_URL, UPDATE_SCRIPT_URL, type VersionCheckResult } from "../../services/versionCheck";
import { pageWindow } from "../../utils/page-context";

const PANEL_ID = "qws-seeddeleter-panel";
const PANEL_POSITION_KEY = "mgSeedDeleter.panelPosition.v1";

const DELETE_CONFIRM_TIMEOUT_MS = 3000;

const COLOR_IDLE = "#2b3340";
const COLOR_RUNNING = "#1f6feb";
const COLOR_PAUSED = "#d29922";

declare const __MG_VERSION__: string;

export interface ToggleModeControl { setMode: (mode: ToggleMode) => void; getMode: () => ToggleMode }

export function createPanel(toggleMode: ToggleModeControl): { panel: HTMLDivElement; setVisible: (v: boolean) => void } {
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  setStyles(panel, {
    position: "fixed",
    right: "16px",
    bottom: "62px",
    zIndex: "999998",
    display: "none",
    flexDirection: "column",
    gap: "8px",
    minWidth: "320px",
    maxWidth: "380px",
    padding: "10px",
    border: "1px solid #39424c",
    borderRadius: "12px",
    background: "rgba(22,27,34,0.96)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    backdropFilter: "blur(2px)",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: "12px",
    color: "#E7EEF7",
  } as any);

  const header = setStyles(document.createElement("div"), {
    display: "flex", alignItems: "center", justifyContent: "space-between",
  });
  const titleCol = document.createElement("div");
  const title = document.createElement("div");
  title.textContent = "🌱 Seed deleter";
  setStyles(title, { fontWeight: "700", fontSize: "13px" });
  const subtitle = document.createElement("div");
  subtitle.textContent = "Pick seeds from your inventory and delete them in bulk.";
  setStyles(subtitle, { fontSize: "11px", opacity: "0.6", marginTop: "2px" });
  titleCol.append(title, subtitle);
  const btnClose = createButton("×", {
    padding: "0 6px",
    lineHeight: "18px",
    fontSize: "14px",
    background: "transparent",
    border: "1px solid transparent",
  });
  btnClose.title = "Close";
  btnClose.setAttribute("aria-label", "Close panel");
  header.append(titleCol, btnClose);

  // --- Selection ---
  const summaryPill = setStyles(document.createElement("div"), {
    padding: "3px 8px",
    borderRadius: "999px",
    border: "1px solid #2b3340",
    background: "#141b22",
    fontSize: "11px",
    fontWeight: "600",
    color: "#dbe7ff",
  });
  summaryPill.textContent = "No seeds selected yet";
  const summaryRow = createVerticalRow("Selection", summaryPill, "What's queued up for deletion right now.");

  const selectionActions = setStyles(document.createElement("div"), { display: "flex", gap: "6px", flexWrap: "wrap" });
  const btnSelect = createButton("Select seeds", { background: "#1f6feb", borderColor: "#1f6feb" });
  const btnClear = createButton("Clear selection");
  selectionActions.append(btnSelect, btnClear);
  const selectionActionsRow = createVerticalRow("Pick seeds", selectionActions, "Opens your inventory so you can choose which seeds to delete.");

  // --- Deletion ---
  const progressTrack = setStyles(document.createElement("div"), {
    width: "100%",
    height: "6px",
    borderRadius: "999px",
    background: "#0a0d11",
    overflow: "hidden",
  });
  const progressFill = setStyles(document.createElement("div"), {
    height: "100%",
    width: "0%",
    borderRadius: "999px",
    background: COLOR_IDLE,
    transition: "width 120ms linear, background 150ms linear",
  });
  progressTrack.appendChild(progressFill);

  const statusLine = setStyles(document.createElement("div"), {
    fontSize: "11px", fontWeight: "600", opacity: "0.85",
  });
  statusLine.textContent = "Idle - nothing is being deleted.";

  const progressCol = setStyles(document.createElement("div"), {
    display: "flex", flexDirection: "column", gap: "6px", width: "100%",
  });
  progressCol.append(statusLine, progressTrack);
  const progressRow = createVerticalRow("Progress", progressCol, "Live status of the current deletion.", { stretch: true });

  const runControls = setStyles(document.createElement("div"), { display: "flex", gap: "6px", flexWrap: "wrap" });
  const btnDelete = createButton("Delete selected", { background: "#a1260d", borderColor: "#a1260d" });
  const btnPause = createButton("Pause");
  const btnPlay = createButton("Play");
  const btnStop = createButton("Stop", { background: "transparent" });
  runControls.append(btnDelete, btnPause, btnPlay, btnStop);
  const runControlsRow = createVerticalRow("Run", runControls, "Start the deletion, or pause/resume/stop it while it runs.");

  // --- Settings ---
  const modeCheckbox = document.createElement("input");
  modeCheckbox.type = "checkbox";
  modeCheckbox.checked = toggleMode.getMode() === "fixed";
  setStyles(modeCheckbox, { width: "16px", height: "16px", cursor: "pointer" });
  modeCheckbox.onchange = () => toggleMode.setMode(modeCheckbox.checked ? "fixed" : "draggable");
  const modeRow = createRow("Lock 🌱 button", modeCheckbox, "When unchecked, you can drag the button anywhere on screen.");

  const hotkeyPicker = createHotkeyPicker();
  const hotkeyRow = createRow("Open panel shortcut", hotkeyPicker, "Press this key anywhere (Esc closes the panel) to open/close it.");

  // --- Info ---
  const versionInfo = setStyles(document.createElement("div"), {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
  });
  const versionBadge = setStyles(document.createElement("div"), {
    fontSize: "11px", fontWeight: "700", padding: "3px 8px", borderRadius: "999px",
    border: "1px solid #2b3340", background: "#141b22", color: "#9aa7b4", cursor: "pointer",
  });
  versionBadge.textContent = `v${__MG_VERSION__}`;
  versionBadge.title = "Click to check for updates now";

  let hasUpdate = false;
  versionBadge.onclick = () => {
    if (hasUpdate) {
      pageWindow.open(UPDATE_SCRIPT_URL, "_blank", "noopener,noreferrer");
      return;
    }
    void checkForUpdates(__MG_VERSION__);
  };

  const githubLink = document.createElement("a");
  githubLink.href = REPO_URL;
  githubLink.target = "_blank";
  githubLink.rel = "noopener noreferrer";
  githubLink.textContent = "GitHub";
  setStyles(githubLink, {
    fontSize: "11px", fontWeight: "600", opacity: "0.7", textDecoration: "underline", color: "inherit",
  } as any);

  versionInfo.append(versionBadge, githubLink);
  const versionRow = createRow("Version", versionInfo, "Auto-checks for updates hourly. Click the version badge to refresh now.");

  const renderVersionStatus = (result: VersionCheckResult | null) => {
    const current = result?.current ?? __MG_VERSION__;
    hasUpdate = result?.status === "update-available" || result?.status === "update-required";
    versionBadge.title = hasUpdate ? "Click to download the update" : "Click to check for updates now";

    if (!result || result.status === "checking") {
      versionBadge.textContent = `v${current} · Checking…`;
      setStyles(versionBadge, { color: "#9aa7b4", borderColor: "#2b3340", background: "#141b22" });
      return;
    }
    if (result.status === "up-to-date") {
      versionBadge.textContent = `v${current} · Up to date`;
      setStyles(versionBadge, { color: "#3fb950", borderColor: "#2ea043", background: "#0f2417" });
    } else if (result.status === "update-available") {
      versionBadge.textContent = `v${current} · Update to v${result.latest}`;
      setStyles(versionBadge, { color: "#d29922", borderColor: "#9e6a03", background: "#2b2110" });
    } else if (result.status === "update-required") {
      versionBadge.textContent = `v${current} · Update required (v${result.latest})`;
      setStyles(versionBadge, { color: "#f85149", borderColor: "#da3633", background: "#2d1214" });
    } else {
      versionBadge.textContent = `v${current} · Check failed`;
      setStyles(versionBadge, { color: "#9aa7b4", borderColor: "#2b3340", background: "#141b22" });
    }
  };
  onVersionCheck(renderVersionStatus);

  // --- Tabs ---
  const tabBar = setStyles(document.createElement("div"), {
    display: "flex", gap: "4px", padding: "3px", borderRadius: "8px",
    background: "#0f1318", border: "1px solid #2b3340",
  });
  const btnTabMain = createButton("Main", { flex: "1" });
  const btnTabSettings = createButton("Settings", { flex: "1" });
  tabBar.append(btnTabMain, btnTabSettings);

  const mainTabContent = setStyles(document.createElement("div"), {
    display: "flex", flexDirection: "column", gap: "8px",
  });
  mainTabContent.append(
    createSectionTitle("Selection"), summaryRow, selectionActionsRow,
    createSectionTitle("Deletion"), runControlsRow, progressRow,
  );

  const settingsTabContent = setStyles(document.createElement("div"), {
    display: "none", flexDirection: "column", gap: "8px",
  });
  settingsTabContent.append(
    createSectionTitle("Settings"), modeRow, hotkeyRow,
    createSectionTitle("Info"), versionRow,
  );

  type TabKey = "main" | "settings";
  const setActiveTab = (tab: TabKey) => {
    const isMain = tab === "main";
    mainTabContent.style.display = isMain ? "flex" : "none";
    settingsTabContent.style.display = isMain ? "none" : "flex";
    setStyles(btnTabMain, { background: isMain ? "#1f6feb" : "transparent", borderColor: isMain ? "#1f6feb" : "#4446" });
    setStyles(btnTabSettings, { background: !isMain ? "#1f6feb" : "transparent", borderColor: !isMain ? "#1f6feb" : "#4446" });
  };
  btnTabMain.onclick = () => setActiveTab("main");
  btnTabSettings.onclick = () => setActiveTab("settings");
  setActiveTab("main");

  panel.append(header, tabBar, mainTabContent, settingsTabContent);
  makeDraggable(panel, header, PANEL_POSITION_KEY);

  const setVisible = (v: boolean) => {
    panel.style.display = v ? "flex" : "none";
    if (v) restoreSavedPosition(panel, PANEL_POSITION_KEY);
  };
  btnClose.onclick = () => setVisible(false);

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (panel.style.display === "none") return;
    setVisible(false);
  });

  const seedStatus = { species: "-", done: 0, total: 0, remaining: 0 };
  let estimatedFinish: number | null = null;
  const describeStatus = () => {
    const running = SeedDeleterService.isSeedDeletionRunning();
    const paused = SeedDeleterService.isSeedDeletionPaused();
    if (!running) return "Idle - nothing is being deleted.";
    const base = `${seedStatus.species || "-"} (${seedStatus.done}/${seedStatus.total})`;
    if (paused) return `Paused - ${base}`;
    const eta = estimatedFinish ? ` · ETA ${formatFinishTime(estimatedFinish)}` : "";
    return `Deleting ${base}${eta}`;
  };
  const updateProgressBar = () => {
    const running = SeedDeleterService.isSeedDeletionRunning();
    const paused = SeedDeleterService.isSeedDeletionPaused();
    const pct = seedStatus.total > 0 ? Math.min(100, Math.round((seedStatus.done / seedStatus.total) * 100)) : 0;
    progressFill.style.width = `${running ? pct : 0}%`;
    progressFill.style.background = !running ? COLOR_IDLE : paused ? COLOR_PAUSED : COLOR_RUNNING;
  };
  const updateStatusUI = () => {
    statusLine.textContent = describeStatus();
    updateProgressBar();
  };
  const updateControlState = () => {
    const running = SeedDeleterService.isSeedDeletionRunning();
    const paused = SeedDeleterService.isSeedDeletionPaused();
    btnPause.disabled = !running || paused;
    btnPlay.disabled = !running || !paused;
    btnStop.disabled = !running;
    btnSelect.disabled = running;
    updateStatusUI();
  };

  let summaryTimer: number | null = null;
  const clearSummaryTimer = () => {
    if (summaryTimer !== null) { clearTimeout(summaryTimer); summaryTimer = null; }
  };
  const scheduleSummaryRefresh = () => {
    clearSummaryTimer();
    summaryTimer = window.setTimeout(() => updateSummaryUI(), 1000);
  };

  function readSelection() {
    const sel = SeedDeleterService.getCurrentSeedSelection() || [];
    let totalQty = 0;
    for (const it of sel) totalQty += Math.max(0, Math.floor((it as any)?.qty || 0));
    return { speciesCount: sel.length, totalQty };
  }

  let deleteArmed = false;
  let deleteArmTimer: number | null = null;
  const defaultDeleteLabel = (totalQty: number) => (totalQty > 0 ? `Delete ${formatNum(totalQty)} seeds` : "Delete selected");
  const resetDeleteArm = () => {
    deleteArmed = false;
    if (deleteArmTimer !== null) { clearTimeout(deleteArmTimer); deleteArmTimer = null; }
    setStyles(btnDelete, { background: "#a1260d", borderColor: "#a1260d" });
    const { totalQty } = readSelection();
    btnDelete.textContent = defaultDeleteLabel(totalQty);
  };

  function updateSummaryUI() {
    const { speciesCount, totalQty } = readSelection();
    const isRunning = SeedDeleterService.isSeedDeletionRunning();

    if (speciesCount <= 0 || totalQty <= 0) {
      summaryPill.textContent = "No seeds selected yet";
    } else {
      const estimateMs = totalQty * (DEFAULT_SEED_DELETE_DELAY_MS + EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS);
      const estimateText = estimateMs > 0 ? ` · ~${formatDurationShort(estimateMs)} to delete` : "";
      summaryPill.textContent = `${speciesCount} species, ${formatNum(totalQty)} seeds selected${estimateText}`;
    }

    const has = speciesCount > 0 && totalQty > 0;
    btnDelete.disabled = !has || isRunning;
    btnClear.disabled = !has;
    if (!deleteArmed) btnDelete.textContent = defaultDeleteLabel(totalQty);

    if (!isRunning && totalQty > 0) scheduleSummaryRefresh(); else clearSummaryTimer();
  }

  const onProgress = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    seedStatus.species = detail.species;
    seedStatus.done = detail.done;
    seedStatus.total = detail.total;
    seedStatus.remaining = detail.remainingForSpecies;
    updateStatusUI();
    updateControlState();
  };
  const onComplete = () => {
    seedStatus.species = "-"; seedStatus.done = 0; seedStatus.total = 0; seedStatus.remaining = 0;
    estimatedFinish = null;
    updateStatusUI();
    updateControlState();
    updateSummaryUI();
  };
  const onPaused = () => updateControlState();
  const onResumed = () => updateControlState();
  window.addEventListener("qws:seeddeleter:progress", onProgress);
  window.addEventListener("qws:seeddeleter:done", onComplete);
  window.addEventListener("qws:seeddeleter:error", onComplete);
  window.addEventListener("qws:seeddeleter:paused", onPaused);
  window.addEventListener("qws:seeddeleter:resumed", onResumed);

  btnPause.onclick = () => { SeedDeleterService.pauseSeedDeletion(); updateControlState(); };
  btnPlay.onclick = () => { SeedDeleterService.resumeSeedDeletion(); updateControlState(); };
  btnStop.onclick = () => { SeedDeleterService.cancelSeedDeletion(); updateControlState(); };

  btnSelect.onclick = async () => {
    await SeedDeleterService.openSeedSelectorFlow(setVisible);
    resetDeleteArm();
    updateSummaryUI();
  };
  btnClear.onclick = () => {
    SeedDeleterService.clearSeedSelection();
    resetDeleteArm();
    updateSummaryUI();
  };
  btnDelete.onclick = async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      btnDelete.textContent = "Click again to confirm";
      setStyles(btnDelete, { background: "#da3633", borderColor: "#da3633" });
      deleteArmTimer = window.setTimeout(resetDeleteArm, DELETE_CONFIRM_TIMEOUT_MS);
      return;
    }

    const { totalQty } = readSelection();
    const estimateMs = totalQty * (DEFAULT_SEED_DELETE_DELAY_MS + EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS);
    estimatedFinish = estimateMs > 0 ? Date.now() + estimateMs : null;
    clearSummaryTimer();
    resetDeleteArm();
    updateControlState();
    const deletionPromise = SeedDeleterService.deleteSelectedSeeds({ delayMs: DEFAULT_SEED_DELETE_DELAY_MS });
    updateSummaryUI();
    await deletionPromise;
    estimatedFinish = null;
    updateSummaryUI();
  };

  updateStatusUI();
  updateControlState();
  updateSummaryUI();

  return { panel, setVisible };
}
