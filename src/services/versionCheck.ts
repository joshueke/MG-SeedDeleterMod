import { pageWindow } from "../utils/page-context";

const PACKAGE_JSON_URL = "https://raw.githubusercontent.com/joshueke/MG-SeedDeleterMod/refs/heads/main/package.json";
const CHECK_TIMEOUT_MS = 8000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export const REPO_URL = "https://github.com/joshueke/MG-SeedDeleterMod";
export const UPDATE_SCRIPT_URL = "https://raw.githubusercontent.com/joshueke/MG-SeedDeleterMod/refs/heads/main/dist/seed-deleter.min.user.js";

export type VersionStatus = "checking" | "up-to-date" | "update-available" | "update-required" | "unknown";

export interface VersionCheckResult {
  status: VersionStatus;
  current: string;
  latest: string | null;
}

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec((v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

let lastResult: VersionCheckResult | null = null;
let checking = false;
const listeners = new Set<(result: VersionCheckResult) => void>();

function emit(result: VersionCheckResult) {
  lastResult = result;
  for (const cb of listeners) { try { cb(result); } catch {} }
}

export function onVersionCheck(cb: (result: VersionCheckResult) => void): () => void {
  listeners.add(cb);
  if (lastResult) cb(lastResult);
  return () => listeners.delete(cb);
}

export function getLastVersionCheck(): VersionCheckResult | null {
  return lastResult;
}

export function isForceUpdateRequired(): boolean {
  return lastResult?.status === "update-required";
}

export async function checkForUpdates(currentVersion: string): Promise<VersionCheckResult> {
  if (checking) return lastResult ?? { status: "checking", current: currentVersion, latest: null };
  checking = true;
  emit({ status: "checking", current: currentVersion, latest: null });

  try {
    const controller = new pageWindow.AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch {} }, CHECK_TIMEOUT_MS);
    let res: Response;
    try {
      res = await pageWindow.fetch(PACKAGE_JSON_URL, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const latest = typeof data?.version === "string" ? data.version.trim() : null;
    if (!latest) throw new Error("Missing version field in remote package.json");

    const cur = parseSemver(currentVersion);
    const rem = parseSemver(latest);

    let status: VersionStatus;
    if (latest === currentVersion) status = "up-to-date";
    else if (cur && rem && rem[0] > cur[0]) status = "update-required";
    else status = "update-available";

    const result: VersionCheckResult = { status, current: currentVersion, latest };
    emit(result);
    return result;
  } catch {
    const result: VersionCheckResult = { status: "unknown", current: currentVersion, latest: null };
    emit(result);
    return result;
  } finally {
    checking = false;
  }
}

let periodicStarted = false;

export function startPeriodicVersionCheck(currentVersion: string): void {
  if (periodicStarted) return;
  periodicStarted = true;
  void checkForUpdates(currentVersion);
  setInterval(() => { void checkForUpdates(currentVersion); }, CHECK_INTERVAL_MS);
}
