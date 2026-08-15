import { SeedDeleterService, DEFAULT_SEED_DELETE_DELAY_MS, createButton } from "../../services/seedDeleter";
import { formatNum, EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS, buildEstimateSentence } from "../../utils/format";
import { setStyles } from "./dom";
import { makeDraggable, restoreSavedPosition } from "./dragPosition";
import { createRow, createVerticalRow } from "./panelRows";
import type { ToggleMode } from "./toggleButton";

const PANEL_ID = "qws-seeddeleter-panel";
const PANEL_POSITION_KEY = "mgSeedDeleter.panelPosition.v1";

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
    gridTemplateRows: "auto auto auto",
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
  const title = document.createElement("div");
  title.textContent = "Seed deleter";
  setStyles(title, { fontWeight: "700", fontSize: "13px" });
  const btnClose = createButton("×", {
    padding: "0 6px",
    lineHeight: "18px",
    fontSize: "14px",
    background: "transparent",
    border: "1px solid transparent",
  });
  btnClose.title = "Close";
  header.append(title, btnClose);

  const summaryPill = setStyles(document.createElement("div"), {
    padding: "3px 8px",
    borderRadius: "999px",
    border: "1px solid #2b3340",
    background: "#141b22",
    fontSize: "11px",
    fontWeight: "600",
    color: "#dbe7ff",
  });
  summaryPill.textContent = "0 species - 0 seeds";
  const summaryRow = createVerticalRow("Selected", summaryPill);

  const actions = setStyles(document.createElement("div"), { display: "flex", gap: "6px", flexWrap: "wrap" });
  const btnSelect = createButton("Select seeds", { background: "#1f6feb", borderColor: "#1f6feb" });
  const btnDelete = createButton("Delete", { background: "#a1260d", borderColor: "#a1260d" });
  const btnClear = createButton("Clear");
  actions.append(btnSelect, btnDelete, btnClear);
  const actionsRow = createRow("Actions", actions);

  const statusLine = setStyles(document.createElement("div"), {
    padding: "3px 8px", borderRadius: "999px", border: "1px solid #2b3340",
    background: "#141b22", fontSize: "11px", fontWeight: "600",
  });
  statusLine.textContent = "Idle";

  const controlRow = setStyles(document.createElement("div"), { display: "flex", gap: "6px", flexWrap: "wrap" });
  const btnPause = createButton("Pause");
  const btnPlay = createButton("Play");
  const btnStop = createButton("Stop", { background: "transparent" });
  controlRow.append(btnPause, btnPlay, btnStop);

  const statusControls = setStyles(document.createElement("div"), {
    display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end",
  });
  statusControls.append(controlRow, statusLine);
  const statusRow = createRow("Status", statusControls);

  const modeCheckbox = document.createElement("input");
  modeCheckbox.type = "checkbox";
  modeCheckbox.checked = toggleMode.getMode() === "fixed";
  setStyles(modeCheckbox, { width: "16px", height: "16px", cursor: "pointer" });
  modeCheckbox.onchange = () => toggleMode.setMode(modeCheckbox.checked ? "fixed" : "draggable");
  const modeRow = createRow("Fixed toggle button", modeCheckbox);

  panel.append(header, summaryRow, actionsRow, statusRow, modeRow);
  makeDraggable(panel, header, PANEL_POSITION_KEY);

  const setVisible = (v: boolean) => {
    panel.style.display = v ? "grid" : "none";
    if (v) restoreSavedPosition(panel, PANEL_POSITION_KEY);
  };
  btnClose.onclick = () => setVisible(false);

  const seedStatus = { species: "-", done: 0, total: 0, remaining: 0 };
  const describeStatus = () => {
    const running = SeedDeleterService.isSeedDeletionRunning();
    const paused = SeedDeleterService.isSeedDeletionPaused();
    const base = `${seedStatus.species || "-"} (${seedStatus.done}/${seedStatus.total})`;
    if (!running) return "Idle";
    return paused ? `Paused - ${base}` : base;
  };
  const updateStatusUI = () => { statusLine.textContent = describeStatus(); };
  const updateControlState = () => {
    const running = SeedDeleterService.isSeedDeletionRunning();
    const paused = SeedDeleterService.isSeedDeletionPaused();
    btnPause.disabled = !running || paused;
    btnPlay.disabled = !running || !paused;
    btnStop.disabled = !running;
    updateStatusUI();
  };

  let estimatedFinish: number | null = null;
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
  function updateSummaryUI() {
    const { speciesCount, totalQty } = readSelection();
    const estimateMs = totalQty * (DEFAULT_SEED_DELETE_DELAY_MS + EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS);
    const isRunning = SeedDeleterService.isSeedDeletionRunning();
    const finishTimestamp = isRunning
      ? estimatedFinish
      : estimateMs > 0 ? Date.now() + estimateMs : null;
    const estimateText = buildEstimateSentence(totalQty, DEFAULT_SEED_DELETE_DELAY_MS, finishTimestamp);
    summaryPill.textContent = `${speciesCount} species - ${formatNum(totalQty)} seeds${estimateText}`;
    const has = speciesCount > 0 && totalQty > 0;
    btnDelete.disabled = !has;
    btnClear.disabled = !has;
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
    updateStatusUI();
    updateControlState();
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
    updateSummaryUI();
  };
  btnClear.onclick = () => {
    SeedDeleterService.clearSeedSelection();
    updateSummaryUI();
  };
  btnDelete.onclick = async () => {
    const { totalQty } = readSelection();
    const estimateMs = totalQty * (DEFAULT_SEED_DELETE_DELAY_MS + EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS);
    estimatedFinish = estimateMs > 0 ? Date.now() + estimateMs : null;
    clearSummaryTimer();
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
