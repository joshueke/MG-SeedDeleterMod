import { pageWindow } from "../utils/page-context";
import { acquireSharedStore } from "./bridge";

export type JotaiStore = {
  get: (atom: any) => any;
  set: (atom: any, value: any) => void | Promise<void>;
  sub: (atom: any, cb: () => void) => () => void;
  __polyfill?: boolean;
};

let _store: JotaiStore | null = null;
let _captureInProgress = false;
let _captureError: unknown = null;
let _lastCapturedVia: "fiber" | "write" | "polyfill" | null = null;

const ATOM_CACHE_WAIT_MS = 20_000;
const WRITE_ONCE_MS = 5_000;

const getAtomCache = () =>
  (pageWindow as any).jotaiAtomCache?.cache as Map<any, any> | undefined;

async function waitForAtomCache(): Promise<Map<any, any> | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ATOM_CACHE_WAIT_MS) {
    const cache = getAtomCache();
    if (cache) return cache;
    await new Promise<void>((r) => setTimeout(r, 100));
  }
  return null;
}

function findStoreViaFiber(): JotaiStore | null {
  const hook: any = (pageWindow as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook?.renderers?.size) return null;

  for (const [rid] of hook.renderers) {
    const roots = hook.getFiberRoots?.(rid);
    if (!roots) continue;

    for (const root of roots) {
      const seen = new Set<any>();
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop();
        if (!f || seen.has(f)) continue;
        seen.add(f);

        const v = f?.pendingProps?.value;
        if (
          v &&
          typeof v.get === "function" &&
          typeof v.set === "function" &&
          typeof v.sub === "function"
        ) {
          _lastCapturedVia = "fiber";
          return v as JotaiStore;
        }
        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
        if (f.alternate) stack.push(f.alternate);
      }
    }
  }
  return null;
}

function makePolyfillStore(): JotaiStore {
  return {
    get: () => { throw new Error("Store non capturé: get indisponible"); },
    set: () => { throw new Error("Store non capturé: set indisponible"); },
    sub: () => () => {},
    __polyfill: true,
  };
}

async function captureViaWriteOnce(): Promise<JotaiStore> {
  let cache = getAtomCache() ?? null;
  if (!cache) {
    console.log("[jotai-bridge] Waiting for jotaiAtomCache...");
    cache = await waitForAtomCache();
  }
  if (!cache) {
    console.warn("[jotai-bridge] jotaiAtomCache.cache introuvable");
    _lastCapturedVia = "polyfill";
    return makePolyfillStore();
  }

  let capturedGet: any = null;
  let capturedSet: any = null;

  const patched: any[] = [];
  const restorePatched = () => {
    for (const a of patched) {
      try {
        if (a.__origWrite) {
          a.write = a.__origWrite;
          delete a.__origWrite;
        }
      } catch {}
    }
  };

  for (const atom of cache.values()) {
    if (!atom || typeof atom.write !== "function" || atom.__origWrite) continue;
    const orig = atom.write;
    atom.__origWrite = orig;
    atom.write = function (get: any, set: any, ...args: any[]) {
      if (!capturedSet) {
        capturedGet = get;
        capturedSet = set;
        restorePatched();
      }
      return orig.call(this, get, set, ...args);
    };
    patched.push(atom);
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();

  try {
    pageWindow.dispatchEvent?.(new pageWindow.Event("visibilitychange"));
  } catch {}

  while (!capturedSet && Date.now() - t0 < WRITE_ONCE_MS) {
    await wait(50);
  }

  if (!capturedSet) {
    restorePatched();
    _lastCapturedVia = "polyfill";
    console.warn("[jotai-bridge] write-once: timeout → polyfill");
    return {
      get: () => {
        throw new Error("Store non capturé: get indisponible");
      },
      set: () => {
        throw new Error("Store non capturé: set indisponible");
      },
      sub: () => () => {},
      __polyfill: true,
    };
  }

  _lastCapturedVia = "write";
  return {
    get: (a: any) => capturedGet(a),
    set: (a: any, v: any) => capturedSet(a, v),
    sub: (a: any, cb: () => void) => {
      let last: any;
      try {
        last = capturedGet(a);
      } catch {}
      const id = setInterval(() => {
        let curr: any;
        try {
          curr = capturedGet(a);
        } catch {
          return;
        }
        if (curr !== last) {
          last = curr;
          try {
            cb();
          } catch {}
        }
      }, 100);
      return () => clearInterval(id as any);
    },
  };
}

const STORE_OWNER = "seed-deleter-mod";

async function rawCapture(): Promise<JotaiStore> {
  const viaFiber = findStoreViaFiber();
  if (viaFiber) return viaFiber;
  return captureViaWriteOnce();
}

export async function ensureStore(): Promise<JotaiStore> {
  if (_store && !_store.__polyfill) return _store;

  if (_captureInProgress) {
    const t0 = Date.now();
    const maxWait = ATOM_CACHE_WAIT_MS + WRITE_ONCE_MS + 1000;
    while (!_store && Date.now() - t0 < maxWait) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (_store && !_store.__polyfill) return _store;
  }

  _captureInProgress = true;
  try {
    _store = await acquireSharedStore(STORE_OWNER, rawCapture);
    return _store;
  } catch (e) {
    _captureError = e;
    throw e;
  } finally {
    _captureInProgress = false;
  }
}

export function isStoreCaptured() {
  return !!_store && !_store.__polyfill;
}

export function getCapturedInfo() {
  return { via: _lastCapturedVia, polyfill: !!_store?.__polyfill, error: _captureError };
}

export async function jGet<T = any>(atom: any): Promise<T> {
  const s = await ensureStore();
  return s.get(atom) as T;
}

export async function jSet(atom: any, value: any): Promise<void> {
  const s = await ensureStore();
  await s.set(atom, value);
}

export async function jSub(atom: any, cb: () => void): Promise<() => void> {
  const s = await ensureStore();
  return s.sub(atom, cb);
}

export function findAtomsByLabel(regex: RegExp): any[] {
  const cache = getAtomCache();
  if (!cache) return [];
  const out: any[] = [];
  for (const a of cache.values()) {
    const label = a?.debugLabel || a?.label || "";
    if (regex.test(String(label))) out.push(a);
  }
  return out;
}

export function getAtomByLabel(label: string): any | null {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return findAtomsByLabel(new RegExp("^" + escape(label) + "$"))[0] || null;
}
