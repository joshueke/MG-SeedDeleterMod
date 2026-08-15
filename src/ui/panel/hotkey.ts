import { createButton } from "../../services/seedDeleter";

const OPEN_HOTKEY_STORAGE_KEY = "mgSeedDeleter.openHotkey.v1";
export const DEFAULT_OPEN_HOTKEY = "Delete";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

const KEY_LABELS: Record<string, string> = {
  Delete: "Del / Canc",
  Backspace: "Backspace",
  Escape: "Esc",
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

function labelForKey(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export function loadOpenHotkey(): string {
  try {
    const stored = localStorage.getItem(OPEN_HOTKEY_STORAGE_KEY);
    if (stored) return stored;
  } catch {}
  return DEFAULT_OPEN_HOTKEY;
}

function saveOpenHotkey(key: string): void {
  try { localStorage.setItem(OPEN_HOTKEY_STORAGE_KEY, key); } catch {}
}

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable === true;
}

export function installOpenHotkeyListener(onTrigger: () => void): () => void {
  const handler = (e: KeyboardEvent) => {
    if (isEditableTarget(document.activeElement)) return;
    if (e.key !== loadOpenHotkey()) return;
    e.preventDefault();
    onTrigger();
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

export function createHotkeyPicker(): HTMLButtonElement {
  const btn = createButton(labelForKey(loadOpenHotkey()), { minWidth: "84px" });
  btn.title = "Click, then press the key you want to use.";

  let removeCapture: (() => void) | null = null;
  const stopCapturing = () => {
    removeCapture?.();
    removeCapture = null;
    btn.textContent = labelForKey(loadOpenHotkey());
  };

  btn.onclick = () => {
    if (removeCapture) return;
    btn.textContent = "Press a key…";

    const onKeyDown = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") { stopCapturing(); return; }
      saveOpenHotkey(e.key);
      stopCapturing();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    removeCapture = () => window.removeEventListener("keydown", onKeyDown, { capture: true } as any);
  };

  return btn;
}
