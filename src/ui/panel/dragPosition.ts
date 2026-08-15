const DRAG_THRESHOLD_PX = 4;

const VIEWPORT_MARGIN_PX = 4;

export interface StoredPosition { xFrac: number; yFrac: number }

export function loadPosition(key: string): StoredPosition | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (typeof parsed?.xFrac === "number" && typeof parsed?.yFrac === "number") return parsed;
  } catch {}
  return null;
}

export function savePosition(key: string, pos: StoredPosition): void {
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

export function placeAt(root: HTMLElement, left: number, top: number): void {
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  root.style.right = "auto";
  root.style.bottom = "auto";
}

export function restoreSavedPosition(root: HTMLElement, storageKey: string): void {
  const saved = loadPosition(storageKey);
  if (!saved) return;
  const r = root.getBoundingClientRect();
  const { left, top } = fracToPx(saved, r.width, r.height);
  placeAt(root, left, top);
}

export interface DragController { setEnabled: (enabled: boolean) => void }

export function makeDraggable(root: HTMLElement, handle: HTMLElement, storageKey?: string): DragController {
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
