import { pageWindow } from "../utils/page-context";
import type { JotaiStore } from "./jotai";

export const STORE_BRIDGE_GLOBAL = "__MG_STORE_BRIDGE__";

type StoreBridge = {
  version: 1;
  owner: string;
  promise: Promise<JotaiStore>;
};

function getBridge(): StoreBridge | null {
  const bridge = (pageWindow as unknown as Record<string, unknown>)[STORE_BRIDGE_GLOBAL] as
    | StoreBridge
    | undefined;
  if (bridge && typeof bridge === "object" && typeof bridge.promise?.then === "function") {
    return bridge;
  }
  return null;
}

export function acquireSharedStore(
  owner: string,
  capture: () => Promise<JotaiStore>,
): Promise<JotaiStore> {
  const existing = getBridge();
  if (existing) return existing.promise;

  const promise = capture().then((store) => {
    if (store.__polyfill) {
      const current = getBridge();
      if (current && current.promise === promise) {
        delete (pageWindow as unknown as Record<string, unknown>)[STORE_BRIDGE_GLOBAL];
      }
    }
    return store;
  });

  (pageWindow as unknown as Record<string, unknown>)[STORE_BRIDGE_GLOBAL] = {
    version: 1,
    owner,
    promise,
  } satisfies StoreBridge;

  return promise;
}
