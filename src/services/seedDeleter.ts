import { plantCatalog } from "../data";
import { Atoms } from "../store/atoms";
import { sendToGame } from "../core/sendToGame";
import { fakeInventoryShow, isInventoryPanelOpen, waitInventoryPanelClosed, fakeInventoryHide } from "./fakeModal";
import { toastSimple } from "../ui/toast";
import { formatNum } from "../utils/format";

export type SeedItem = {
  species: string;
  itemType: "Seed";
  quantity: number;
  id?: string;
};
export type InventoryShape = { items: any[]; favoritedItemIds?: string[] };

type SeedSelection = { name: string; qty: number; maxQty: number };

async function wish(itemId: string) {
  try { sendToGame({ type: "Wish", itemId }); } catch {}
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function buildDisplayNameToSpeciesFromCatalog(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  try {
    const cat = plantCatalog as any;
    for (const species of Object.keys(cat || {})) {
      const seedName: string =
        (cat?.[species]?.seed?.name && String(cat?.[species]?.seed?.name)) || `${species} Seed`;
      const arr = map.get(seedName) ?? [];
      arr.push(species);
      map.set(seedName, arr);
    }
  } catch {}
  return map;
}

function seedDisplayNameFromSpecies(species: string): string {
  try {
    const node = (plantCatalog as any)?.[species];
    const n = node?.seed?.name;
    if (typeof n === "string" && n) return n;
  } catch {}
  return `${species} Seed`;
}

function normalizeSeedItem(x: any): SeedItem | null {
  if (!x || typeof x !== "object") return null;
  const species = typeof x.species === "string" ? x.species.trim() : "";
  const itemType = x.itemType === "Seed" ? "Seed" : null;
  const quantity = Number.isFinite(x.quantity) ? Math.max(0, Math.floor(x.quantity)) : 0;
  if (!species || itemType !== "Seed" || quantity <= 0) return null;
  return { species, itemType: "Seed", quantity, id: `seed:${species}` };
}

export async function getMySeedInventory(): Promise<SeedItem[]> {
  try {
    const raw = await Atoms.inventory.mySeedInventory.get();
    if (!Array.isArray(raw)) return [];
    const out: SeedItem[] = [];
    raw.forEach((x) => { const s = normalizeSeedItem(x); if (s) out.push(s); });
    return out;
  } catch { return []; }
}

function buildInventoryShapeFrom(items: SeedItem[]): InventoryShape {
  return { items, favoritedItemIds: [] };
}

async function buildSpeciesStockFromInventory(): Promise<Map<string, number>> {
  const inv = await getMySeedInventory();
  const stock = new Map<string, number>();
  for (const it of inv) {
    const q = Math.max(0, Math.floor(it.quantity || 0));
    if (q > 0) stock.set(it.species, (stock.get(it.species) ?? 0) + q);
  }
  return stock;
}

function allocateForRequestedName(
  requested: { name: string; qty: number },
  nameToSpecies: Map<string, string[]>,
  speciesStock: Map<string, number>
): { species: string; qty: number }[] {
  let remaining = Math.max(0, Math.floor(requested.qty || 0));
  let candidates = nameToSpecies.get(requested.name) ?? [];

  if (!candidates.length && / seed$/i.test(requested.name)) {
    const fallbackSpecies = requested.name.replace(/\s+seed$/i, "");
    if ((plantCatalog as any)?.[fallbackSpecies]) candidates = [fallbackSpecies];
  }

  if (!candidates.length || remaining <= 0) return [];

  const ranked = candidates
    .map(sp => ({ sp, available: speciesStock.get(sp) ?? 0 }))
    .filter(x => x.available > 0)
    .sort((a, b) => b.available - a.available);

  const out: { species: string; qty: number }[] = [];
  for (const { sp, available } of ranked) {
    if (remaining <= 0) break;
    const take = Math.min(available, remaining);
    if (take > 0) {
      out.push({ species: sp, qty: take });
      remaining -= take;
    }
  }
  return out;
}

let _seedDeleteAbort: AbortController | null = null;
let _seedDeleteBusy = false;
let _seedDeletePaused = false;
let _seedDeletePauseResolver: (() => void) | null = null;

export const DEFAULT_SEED_DELETE_DELAY_MS = 35;

type DeleteOpts = {
  selection?: { name: string; qty: number }[];
  delayMs?: number;
  keepSelection?: boolean;
  onProgress?: (info: { done: number; total: number; species: string; remainingForSpecies: number }) => void;
};

async function waitSeedPause() {
  while (_seedDeletePaused) {
    await new Promise<void>((resolve) => {
      _seedDeletePauseResolver = resolve;
    });
    _seedDeletePauseResolver = null;
  }
}

export async function deleteSelectedSeeds(opts: DeleteOpts = {}) {
  if (_seedDeleteBusy) {
    await toastSimple("Seed deleter", "Deletion already in progress.", "info");
    return;
  }

  const delayMs = Math.max(0, Math.floor(opts.delayMs ?? DEFAULT_SEED_DELETE_DELAY_MS));

  const selection = (opts.selection && Array.isArray(opts.selection) ? opts.selection : Array.from(selectedMap.values()))
    .map(s => ({ name: s.name, qty: Math.max(0, Math.floor(s.qty || 0)) }))
    .filter(s => s.qty > 0);

  if (selection.length === 0) {
    await toastSimple("Seed deleter", "No seeds selected.", "info");
    return;
  }

  const nameToSpecies = buildDisplayNameToSpeciesFromCatalog();
  const speciesStock = await buildSpeciesStockFromInventory();

  // Some species held in the live inventory (e.g. rarer/event-only seeds) may not
  // exist in the hardcoded catalog yet. Fall back to their held species directly so
  // deletion still works instead of silently reporting "not in inventory".
  for (const species of speciesStock.keys()) {
    const dispName = seedDisplayNameFromSpecies(species);
    const arr = nameToSpecies.get(dispName) ?? [];
    if (!arr.includes(species)) arr.push(species);
    nameToSpecies.set(dispName, arr);
  }

  const allocatedBySpecies = new Map<string, number>();
  let requestedTotal = 0, cappedTotal = 0;
  for (const req of selection) {
    requestedTotal += req.qty;
    const chunks = allocateForRequestedName(req, nameToSpecies, speciesStock);
    const okForThis = chunks.reduce((a, c) => a + c.qty, 0);
    cappedTotal += okForThis;
    for (const c of chunks) {
      allocatedBySpecies.set(c.species, (allocatedBySpecies.get(c.species) ?? 0) + c.qty);
    }
  }

  if (cappedTotal <= 0) {
    await toastSimple("Seed deleter", "Nothing to delete (not in inventory).", "info");
    return;
  }
  if (cappedTotal < requestedTotal) {
    await toastSimple(
      "Seed deleter",
      `Requested ${formatNum(requestedTotal)} but only ${formatNum(cappedTotal)} available. Proceeding.`,
      "info"
    );
  }

  const tasks = Array.from(allocatedBySpecies.entries())
    .map(([species, qty]) => ({ species, qty: Math.max(0, Math.floor(qty || 0)) }))
    .filter(t => t.qty > 0);

  const total = tasks.reduce((acc, t) => acc + t.qty, 0);
  if (total <= 0) {
    await toastSimple("Seed deleter", "Nothing to delete.", "info");
    return;
  }

  _seedDeleteBusy = true;
  const abort = new AbortController();
  _seedDeleteAbort = abort;
  let doneDetail: { total: number; speciesCount: number } | null = null;
  let errorMsg: string | null = null;

  try {
    await toastSimple("Seed deleter", `Deleting ${formatNum(total)} seeds across ${tasks.length} species...`, "info");

    let done = 0;
    let successfulDeletes = 0;
    for (const t of tasks) {
      let remaining = t.qty;
      while (remaining > 0) {
        if (abort.signal.aborted) throw new Error("Deletion cancelled.");
        await waitSeedPause();

        let attemptSucceeded = false;
        try {
          await wish(t.species);
          attemptSucceeded = true;
        } catch {}

        if (attemptSucceeded) successfulDeletes += 1;
        done += 1;
        remaining -= 1;

        try {
          opts.onProgress?.({ done, total, species: t.species, remainingForSpecies: remaining });
          window.dispatchEvent(new CustomEvent("qws:seeddeleter:progress", {
            detail: { done, total, species: t.species, remainingForSpecies: remaining }
          }));
        } catch {}

        if (delayMs > 0 && remaining > 0) await sleep(delayMs);
      }
    }

    if (!opts.keepSelection) selectedMap.clear();

    if (successfulDeletes > 0) {
      await toastSimple("Seed deleter", `Deleted ${formatNum(successfulDeletes)} seeds (${tasks.length} species).`, "success");
    } else {
      await toastSimple("Seed deleter", "No seeds were deleted (requests failed).", "info");
    }

    doneDetail = { total, speciesCount: tasks.length };
  } catch (e: any) {
    const msg = e?.message || "Deletion failed.";
    errorMsg = msg;
    await toastSimple("Seed deleter", msg, "error");
  } finally {
    _seedDeleteBusy = false;
    _seedDeletePaused = false;
    _seedDeleteAbort = null;
    _seedDeletePauseResolver?.();
    _seedDeletePauseResolver = null;

    if (errorMsg !== null) {
      try { window.dispatchEvent(new CustomEvent("qws:seeddeleter:error", { detail: { message: errorMsg } })); } catch {}
    } else if (doneDetail) {
      try { window.dispatchEvent(new CustomEvent("qws:seeddeleter:done", { detail: doneDetail })); } catch {}
    }
  }
}

export function cancelSeedDeletion() {
  try {
    _seedDeletePaused = false;
    _seedDeletePauseResolver?.();
    _seedDeletePauseResolver = null;
    _seedDeleteAbort?.abort();
  } catch {}
}
export function isSeedDeletionRunning() {
  return _seedDeleteBusy;
}
export function pauseSeedDeletion() {
  if (!_seedDeleteBusy || _seedDeletePaused) return;
  _seedDeletePaused = true;
  try {
    window.dispatchEvent(new CustomEvent("qws:seeddeleter:paused"));
  } catch {}
}
export function resumeSeedDeletion() {
  if (!_seedDeletePaused) return;
  _seedDeletePaused = false;
  _seedDeletePauseResolver?.();
  _seedDeletePauseResolver = null;
  try {
    window.dispatchEvent(new CustomEvent("qws:seeddeleter:resumed"));
  } catch {}
}
export function isSeedDeletionPaused() {
  return _seedDeletePaused;
}

try {
  window.addEventListener("qws:seeddeleter:apply", async (e: any) => {
    try {
      const selection = Array.isArray(e?.detail?.selection) ? e.detail.selection : undefined;
      await deleteSelectedSeeds({ selection, delayMs: DEFAULT_SEED_DELETE_DELAY_MS, keepSelection: false });
    } catch {}
  });
} catch {}

const selectedMap = new Map<string, SeedSelection>();
let seedStockByName = new Map<string, number>();
let seedSourceCache: SeedItem[] = [];

async function clearUiSelectionAtoms() {
  try { await Atoms.inventory.mySelectedItemName.set(null); } catch {}
  try { await Atoms.inventory.mySelectedItemId.set(null); } catch {}
  try { await Atoms.inventory.myValidatedSelectedItemIndex.set(null); } catch {}
  try { await Atoms.inventory.myPossiblyNoLongerValidSelectedItemIndex.set(null); } catch {}
}

const OVERLAY_ID = "qws-seeddeleter-overlay";
const LIST_ID = "qws-seeddeleter-list";
const SUMMARY_ID = "qws-seeddeleter-summary";

function setStyles(el: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(el.style, styles);
}

function styleOverlayBox(div: HTMLDivElement, id: string) {
  div.id = id;
  setStyles(div, {
    position: "fixed",
    left: "12px",
    top: "12px",
    zIndex: "999999",
    display: "grid",
    gridTemplateRows: "auto auto 1px 1fr auto",
    gap: "6px",
    minWidth: "320px",
    maxWidth: "420px",
    maxHeight: "52vh",
    padding: "8px",
    border: "1px solid #39424c",
    borderRadius: "10px",
    background: "rgba(22,27,34,0.92)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    backdropFilter: "blur(2px)",
    userSelect: "none",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: "12px",
    lineHeight: "1.25",
  } as any);
}

function makeDraggable(root: HTMLDivElement, handle: HTMLElement) {
  let dragging = false;
  let ox = 0, oy = 0;

  const onDown = (e: MouseEvent) => {
    dragging = true;
    const r = root.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp, { once: true });
  };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const nx = Math.max(4, e.clientX - ox);
    const ny = Math.max(4, e.clientY - oy);
    root.style.left = `${nx}px`;
    root.style.top = `${ny}px`;
  };
  const onUp = () => {
    dragging = false;
    document.removeEventListener("mousemove", onMove);
  };

  handle.addEventListener("mousedown", onDown);
}

const BTN_STYLE_ID = "qws-seeddeleter-btn-style";
const BTN_CLASS = "qws-sd-btn";
function ensureButtonStylesInjected() {
  if (document.getElementById(BTN_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = BTN_STYLE_ID;
  style.textContent = `
    .${BTN_CLASS} { cursor: pointer; transition: filter 100ms ease, border-color 100ms ease, transform 80ms ease, opacity 100ms ease; }
    .${BTN_CLASS}:hover:not(:disabled) { filter: brightness(1.25); border-color: #8ac6ff; transform: translateY(-1px); }
    .${BTN_CLASS}:active:not(:disabled) { filter: brightness(0.9); transform: translateY(0); }
    .${BTN_CLASS}:disabled { opacity: 0.4; cursor: not-allowed; filter: grayscale(0.4); }
  `;
  document.head.appendChild(style);
}

export function createButton(label: string, styleOverride?: Partial<CSSStyleDeclaration>) {
  ensureButtonStylesInjected();
  const b = document.createElement("button");
  b.textContent = label;
  b.classList.add(BTN_CLASS);
  setStyles(b, {
    padding: "4px 8px",
    borderRadius: "8px",
    border: "1px solid #4446",
    background: "#161b22",
    color: "#E7EEF7",
    fontWeight: "600",
    fontSize: "12px",
    ...styleOverride,
  });
  return b;
}

let overlayKeyGuardsOn = false;
function isInsideOverlay(el: Element | null) {
  return !!(el && (el as HTMLElement).closest?.(`#${OVERLAY_ID}`));
}
function keyGuardCapture(e: KeyboardEvent) {
  const ae = document.activeElement as HTMLElement | null;
  if (!isInsideOverlay(ae)) return;
  const tag = (ae?.tagName || "").toLowerCase();
  const isEditable = tag === "input" || tag === "textarea" || (ae && (ae as any).isContentEditable);
  if (!isEditable) return;
  if (/^[0-9]$/.test(e.key)) {
    e.stopImmediatePropagation();
  }
}
function installOverlayKeyGuards() {
  if (overlayKeyGuardsOn) return;
  window.addEventListener("keydown", keyGuardCapture, { capture: true });
  overlayKeyGuardsOn = true;
}
function removeOverlayKeyGuards() {
  if (!overlayKeyGuardsOn) return;
  window.removeEventListener("keydown", keyGuardCapture, { capture: true } as any);
  overlayKeyGuardsOn = false;
}

async function closeSeedInventoryPanel() {
  try {
    await fakeInventoryHide();
  } catch {
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    } catch {}
  }
}

let _btnConfirm: HTMLButtonElement | null = null;

function createSeedOverlay(): HTMLDivElement {
  const box = document.createElement("div");
  styleOverlayBox(box, OVERLAY_ID);

  const header = document.createElement("div");
  setStyles(header, { display: "flex", alignItems: "center", gap: "4px", cursor: "move" });

  const title = document.createElement("div");
  title.textContent = "🎯 Selection mode";
  setStyles(title, { fontWeight: "700", fontSize: "13px" });

  const hint = document.createElement("div");
  hint.textContent = "Click seeds in inventory to toggle selection.";
  setStyles(hint, { opacity: "0.8", fontSize: "11px" });

  const hr = document.createElement("div");
  setStyles(hr, { height: "1px", background: "#2d333b" });

  const list = document.createElement("div");
  list.id = LIST_ID;
  setStyles(list, {
    minHeight: "44px",
    maxHeight: "26vh",
    overflow: "auto",
    padding: "4px",
    border: "1px dashed #39424c",
    borderRadius: "8px",
    background: "rgba(15,19,24,0.84)",
    userSelect: "text",
  });

  const actions = document.createElement("div");
  setStyles(actions, { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" });

  const summary = document.createElement("div");
  summary.id = SUMMARY_ID;
  setStyles(summary, { fontWeight: "600" });
  summary.textContent = "Selected: 0 species · 0 seeds";

  const btnClear = createButton("Clear");
  btnClear.title = "Clear selection";
  btnClear.onclick = async () => {
    selectedMap.clear();
    refreshList();
    updateSummary();
    await clearUiSelectionAtoms();
    await repatchFakeSeedInventoryWithSelection();
  };

  _btnConfirm = createButton("Confirm", { background: "#1F2328CC" });
  _btnConfirm.disabled = true;
  _btnConfirm.onclick = async () => {
    await closeSeedInventoryPanel();
  };

  header.append(title);
  actions.append(summary, btnClear, _btnConfirm);
  box.append(header, hint, hr, list, actions);

  makeDraggable(box, header);
  return box;
}

function centerOverlay(el: HTMLDivElement) {
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(4, (window.innerWidth - r.width) / 2)}px`;
  el.style.top = `${Math.max(4, (window.innerHeight - r.height) / 2)}px`;
}

function showSeedOverlay() {
  if (document.getElementById(OVERLAY_ID)) return;
  const el = createSeedOverlay();
  document.body.appendChild(el);
  centerOverlay(el);
  installOverlayKeyGuards();
  refreshList();
  updateSummary();
}
function hideSeedOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.remove();
  removeOverlayKeyGuards();
}
export function isSelectionOverlayOpen(): boolean {
  return !!document.getElementById(OVERLAY_ID);
}

function renderListRow(item: SeedSelection): HTMLElement {
  const row = document.createElement("div");
  setStyles(row, {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    gap: "6px",
    padding: "4px 6px",
    borderBottom: "1px dashed #2d333b",
  });

  const name = document.createElement("div");
  name.textContent = item.name;
  setStyles(name, {
    fontSize: "12px",
    fontWeight: "600",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });

  const controls = document.createElement("div");
  setStyles(controls, { display: "flex", alignItems: "center", gap: "6px" });

  const qty = document.createElement("input");
  qty.type = "number";
  qty.min = "1";
  qty.max = String(Math.max(1, item.maxQty));
  qty.step = "1";
  qty.value = String(item.qty);
  setStyles(qty, {
    width: "68px",
    height: "28px",
    border: "1px solid #4446",
    borderRadius: "8px",
    background: "rgba(15,19,24,0.90)",
    padding: "0 8px",
    fontSize: "12px",
  } as any);

  const swallowDigits = (e: KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) {
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  };
  qty.addEventListener("keydown", swallowDigits);

  const updateQty = async () => {
    const v = Math.min(item.maxQty, Math.max(1, Math.floor(Number(qty.value) || 1)));
    qty.value = String(v);
    const cur = selectedMap.get(item.name);
    if (!cur) return;
    cur.qty = v;
    selectedMap.set(item.name, cur);
    updateSummary();
    await repatchFakeSeedInventoryWithSelection();
  };
  qty.onchange = () => { void updateQty(); };
  qty.oninput = () => { void updateQty(); };

  const remove = createButton("Remove", { background: "transparent" });
  remove.onclick = async () => {
    selectedMap.delete(item.name);
    refreshList();
    updateSummary();
    await repatchFakeSeedInventoryWithSelection();
  };

  controls.append(qty, remove);
  row.append(name, controls);
  return row;
}

function refreshList() {
  const list = document.getElementById(LIST_ID) as HTMLDivElement | null;
  if (!list) return;
  list.innerHTML = "";
  const entries = Array.from(selectedMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No seeds selected.";
    empty.style.opacity = "0.8";
    list.appendChild(empty);
    return;
  }
  for (const it of entries) list.appendChild(renderListRow(it));
}

function totalSelected() {
  let species = 0, qty = 0;
  for (const it of selectedMap.values()) { species += 1; qty += it.qty; }
  return { species, qty };
}

function updateSummary() {
  const { species, qty } = totalSelected();
  const el = document.getElementById(SUMMARY_ID);
  if (el) el.textContent = `Selected: ${species} species · ${formatNum(qty)} seeds`;
  if (_btnConfirm) {
    _btnConfirm.textContent = "Confirm";
    _btnConfirm.disabled = qty <= 0;
    _btnConfirm.style.opacity = qty <= 0 ? "0.6" : "1";
    _btnConfirm.style.cursor = qty <= 0 ? "not-allowed" : "pointer";
  }
}

async function repatchFakeSeedInventoryWithSelection() {
  const src = Array.isArray(seedSourceCache) ? seedSourceCache : [];

  const remainingByName = new Map<string, number>();
  for (const s of src) {
    const disp = seedDisplayNameFromSpecies(s.species);
    const qty = Math.max(0, Math.floor(s.quantity || 0));
    remainingByName.set(disp, (remainingByName.get(disp) ?? 0) + qty);
  }
  for (const sel of selectedMap.values()) {
    const cur = remainingByName.get(sel.name) ?? 0;
    const picked = Math.max(0, Math.floor(sel.qty || 0));
    remainingByName.set(sel.name, Math.max(0, cur - picked));
  }

  const patched: SeedItem[] = [];
  for (const s of src) {
    const disp = seedDisplayNameFromSpecies(s.species);
    const remaining = remainingByName.get(disp) ?? 0;
    if (remaining <= 0) continue;
    const take = Math.min(remaining, Math.max(0, Math.floor(s.quantity || 0)));
    if (take <= 0) continue;
    patched.push({ ...s, quantity: take });
    remainingByName.set(disp, remaining - take);
  }

  try {
    await fakeInventoryShow({ items: patched, favoritedItemIds: [] }, { open: false });
  } catch {}
}

let unsubSelectedName: null | (() => void | Promise<void>) = null;

async function beginSelectedNameListener() {
  if (unsubSelectedName) return;

  const unsub = await Atoms.inventory.mySelectedItemName.onChange(async (name: string | null) => {
    const n = (name || "").trim();
    if (!n) return;

    const max = Math.max(1, seedStockByName.get(n) ?? 1);
    const existing = selectedMap.get(n);
    if (existing) {
      existing.qty = max;
      existing.maxQty = max;
      selectedMap.set(n, existing);
    } else {
      selectedMap.set(n, { name: n, qty: max, maxQty: max });
    }

    refreshList();
    updateSummary();

    await clearUiSelectionAtoms();
    await repatchFakeSeedInventoryWithSelection();
  });

  unsubSelectedName = typeof unsub === "function" ? unsub : null;
}

async function endSelectedNameListener() {
  const fn = unsubSelectedName;
  unsubSelectedName = null;
  try { await fn?.(); } catch {}
}

export async function openSeedSelectorFlow(setWindowVisible?: (v: boolean) => void) {
  try {
    setWindowVisible?.(false);

    seedSourceCache = await getMySeedInventory();
    seedStockByName = new Map<string, number>();
    for (const s of seedSourceCache) {
      const display = seedDisplayNameFromSpecies(s.species);
      seedStockByName.set(display, Math.max(1, Math.floor(s.quantity || 0)));
    }

    selectedMap.clear();
    showSeedOverlay();
    await beginSelectedNameListener();

    await fakeInventoryShow(buildInventoryShapeFrom(seedSourceCache), { open: true });

    if (await isInventoryPanelOpen()) {
      await waitInventoryPanelClosed();
    }
  } catch (e: any) {
    await toastSimple("Seed inventory", e?.message || "Failed to open seed selector.", "error");
  } finally {
    await endSelectedNameListener();
    hideSeedOverlay();
    seedSourceCache = [];
    seedStockByName.clear();
    setWindowVisible?.(true);
  }
}

export const SeedDeleterService = {
  getMySeedInventory,
  openSeedSelectorFlow,

  deleteSelectedSeeds,
  cancelSeedDeletion,
  isSeedDeletionRunning,
  pauseSeedDeletion,
  resumeSeedDeletion,
  isSeedDeletionPaused,

  getCurrentSeedSelection(): SeedSelection[] {
    return Array.from(selectedMap.values());
  },
  clearSeedSelection() {
    selectedMap.clear();
  },
};
