import { SeedDeleterService, DEFAULT_SEED_DELETE_DELAY_MS, createButton } from "../services/seedDeleter";

const TOGGLE_ID = "qws-seeddeleter-toggle";
const PANEL_ID = "qws-seeddeleter-panel";

const TOGGLE_POSITION_KEY = "mgSeedDeleter.togglePosition.v1";
const PANEL_POSITION_KEY = "mgSeedDeleter.panelPosition.v1";
const TOGGLE_MODE_KEY = "mgSeedDeleter.toggleMode.v1";

type ToggleMode = "draggable" | "fixed";
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

const NF_US = new Intl.NumberFormat("en-US");
const formatNum = (n: number) => NF_US.format(Math.max(0, Math.floor(n || 0)));

const EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS = 10;

function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  return `${Math.round(seconds)} s`;
}

function formatFinishTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function buildEstimateSentence(count: number, delayMs: number, finishTimestamp: number | null): string {
  if (count <= 0 || delayMs <= 0) return "";
  const durationMs = count * (delayMs + EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS);
  const durationText = formatDurationShort(durationMs);
  if (!finishTimestamp) return ` · Estimated time ${durationText}`;
  return ` · Estimated time ${durationText} (${formatFinishTime(finishTimestamp)})`;
}

function setStyles<T extends HTMLElement>(el: T, styles: Partial<CSSStyleDeclaration>): T {
  Object.assign(el.style, styles);
  return el;
}

const DRAG_THRESHOLD_PX = 4;

const VIEWPORT_MARGIN_PX = 4;

interface StoredPosition { xFrac: number; yFrac: number }

function loadPosition(key: string): StoredPosition | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (typeof parsed?.xFrac === "number" && typeof parsed?.yFrac === "number") return parsed;
  } catch {}
  return null;
}

function savePosition(key: string, pos: StoredPosition): void {
  try { localStorage.setItem(key, JSON.stringify(pos)); } catch {}
}

function fracRange(size: number, viewportSize: number): number {
  return Math.max(0, viewportSize - size - 2 * VIEWPORT_MARGIN_PX);
}

function fracToPx(pos: StoredPosition, width: number, height: number): { left: number; top: number } {
  return {
    left: VIEWPORT_MARGIN_PX + pos.xFrac * fracRange(width, window.innerWidth),
    top: VIEWPORT_MARGIN_PX + pos.yFrac * fracRange(height, window.innerHeight),
  };
}

function pxToFrac(left: number, top: number, width: number, height: number): StoredPosition {
  const rangeX = fracRange(width, window.innerWidth);
  const rangeY = fracRange(height, window.innerHeight);
  return {
    xFrac: rangeX > 0 ? Math.min(1, Math.max(0, (left - VIEWPORT_MARGIN_PX) / rangeX)) : 0,
    yFrac: rangeY > 0 ? Math.min(1, Math.max(0, (top - VIEWPORT_MARGIN_PX) / rangeY)) : 0,
  };
}

function placeAt(root: HTMLElement, left: number, top: number): void {
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  root.style.right = "auto";
  root.style.bottom = "auto";
}

function restoreSavedPosition(root: HTMLElement, storageKey: string): void {
  const saved = loadPosition(storageKey);
  if (!saved) return;
  const r = root.getBoundingClientRect();
  const { left, top } = fracToPx(saved, r.width, r.height);
  placeAt(root, left, top);
}

interface DragController { setEnabled: (enabled: boolean) => void }

function makeDraggable(root: HTMLElement, handle: HTMLElement, storageKey?: string): DragController {
  let dragging = false;
  let moved = false;
  let enabled = true;
  let ox = 0, oy = 0;
  let startX = 0, startY = 0;
  let width = 0, height = 0;

  handle.style.cursor = "grab";
  if (storageKey) {
    restoreSavedPosition(root, storageKey);
    window.addEventListener("resize", () => { if (enabled) restoreSavedPosition(root, storageKey); });
  }

  const onDown = (e: MouseEvent) => {
    if (!enabled || e.button !== 0) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const r = root.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    width = r.width;
    height = r.height;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp, { once: true });
  };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    if (!moved) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      moved = true;
      handle.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }
    const maxX = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX);
    const maxY = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - height - VIEWPORT_MARGIN_PX);
    const left = Math.min(Math.max(VIEWPORT_MARGIN_PX, e.clientX - ox), maxX);
    const top = Math.min(Math.max(VIEWPORT_MARGIN_PX, e.clientY - oy), maxY);
    placeAt(root, left, top);
  };
  const onUp = () => {
    dragging = false;
    handle.style.cursor = enabled ? "grab" : "pointer";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMove);
    if (moved && storageKey) {
      const r = root.getBoundingClientRect();
      savePosition(storageKey, pxToFrac(r.left, r.top, r.width, r.height));
    }
  };
  const onClickCapture = (e: MouseEvent) => {
    if (moved) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  handle.addEventListener("mousedown", onDown);
  handle.addEventListener("click", onClickCapture, true);

  return {
    setEnabled(v: boolean) {
      enabled = v;
      handle.style.cursor = v ? "grab" : "pointer";
      if (v && storageKey) restoreSavedPosition(root, storageKey);
    },
  };
}

interface ToggleButtonController {
  btn: HTMLButtonElement;
  setMode: (mode: ToggleMode) => void;
  getMode: () => ToggleMode;
}

function createToggleButton(onToggle: () => void): ToggleButtonController {
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

function createRow(label: string, control: HTMLElement): HTMLElement {
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

function createVerticalRow(label: string, control: HTMLElement): HTMLElement {
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

interface ToggleModeControl { setMode: (mode: ToggleMode) => void; getMode: () => ToggleMode }

function createPanel(toggleMode: ToggleModeControl): { panel: HTMLDivElement; setVisible: (v: boolean) => void } {
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
