import { ensureStore as ensureJotaiStore, getAtomByLabel, jGet, jSub, jSet } from "./jotai";

export type Unsubscribe = () => void;

const ATOM_POLL_MS = 250;
const ATOM_WAIT_TIMEOUT_MS = 10 * 60_000;

type PendingWaiter = {
  label: string;
  expiresAt: number;
  resolve: (atom: unknown | null) => void;
};

const pendingWaiters = new Set<PendingWaiter>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPoller(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function pollPendingWaiters(): void {
  const now = Date.now();
  for (const waiter of Array.from(pendingWaiters)) {
    const atom = getAtomByLabel(waiter.label);
    if (atom) {
      pendingWaiters.delete(waiter);
      waiter.resolve(atom);
      continue;
    }
    if (now >= waiter.expiresAt) {
      pendingWaiters.delete(waiter);
      waiter.resolve(null);
    }
  }
  if (!pendingWaiters.size) stopPoller();
}

function ensurePoller(): void {
  if (pollTimer !== null) return;
  pollTimer = setInterval(pollPendingWaiters, ATOM_POLL_MS);
}

function waitForAtom(label: string): Promise<unknown | null> {
  return new Promise((resolve) => {
    const waiter: PendingWaiter = {
      label,
      expiresAt: Date.now() + ATOM_WAIT_TIMEOUT_MS,
      resolve,
    };
    pendingWaiters.add(waiter);
    ensurePoller();
  });
}

export async function ensureStore() {
try { await ensureJotaiStore(); } catch {}
}

export async function select<T>(label: string, fallback?: T): Promise<T | undefined> {
await ensureStore();
const atom = getAtomByLabel(label);
if (!atom) return fallback;
try { return await jGet<T>(atom); } catch { return fallback; }
}

export async function hasAtom(label: string): Promise<boolean> {
  await ensureStore();
  return !!getAtomByLabel(label);
}

export async function subscribe<T>(label: string, cb: (value: T) => void): Promise<Unsubscribe> {
  await ensureStore();
  let cancelled = false;
  let attachedUnsub: Unsubscribe | null = null;

  const attach = async (atom: unknown): Promise<void> => {
    const unsub = await jSub(atom, async () => {
      try { cb(await jGet<T>(atom)); } catch {}
    });
    if (cancelled) {
      try { unsub(); } catch {}
      return;
    }
    attachedUnsub = unsub;
  };

  const atom = getAtomByLabel(label);
  if (atom) {
    await attach(atom);
  } else {
    void (async () => {
      const found = await waitForAtom(label);
      if (!found || cancelled) return;
      try { await attach(found); } catch {}
    })();
  }

  return () => {
    cancelled = true;
    const unsub = attachedUnsub;
    attachedUnsub = null;
    try { unsub?.(); } catch {}
  };
}

export async function subscribeImmediate<T>(label: string, cb: (value: T) => void): Promise<Unsubscribe> {
  await ensureStore();
  let cancelled = false;
  let attachedUnsub: Unsubscribe | null = null;

  const attach = async (atom: unknown): Promise<void> => {
    const unsub = await jSub(atom, async () => {
      try { cb(await jGet<T>(atom)); } catch {}
    });
    if (cancelled) {
      try { unsub(); } catch {}
      return;
    }
    attachedUnsub = unsub;
    try {
      const current = await jGet<T>(atom);
      if (!cancelled && current !== undefined) cb(current);
    } catch {}
  };

  const atom = getAtomByLabel(label);
  if (atom) {
    await attach(atom);
  } else {
    void (async () => {
      const found = await waitForAtom(label);
      if (!found || cancelled) return;
      try { await attach(found); } catch {}
    })();
  }

  return () => {
    cancelled = true;
    const unsub = attachedUnsub;
    attachedUnsub = null;
    try { unsub?.(); } catch {}
  };
}

export async function set(label: string, value: any) {
  await ensureStore();
  const atom = getAtomByLabel(label);
  if (!atom) return;
  await jSet(atom, value);
}
export const Store = { ensure: ensureStore, select, subscribe, subscribeImmediate, set, hasAtom };
