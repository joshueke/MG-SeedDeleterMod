declare const unsafeWindow:
  | (Window & typeof globalThis & { [key: string]: any })
  | undefined;

const sandboxWin = window;
const pageWin =
  typeof unsafeWindow !== "undefined" && unsafeWindow
    ? unsafeWindow
    : sandboxWin;

export const pageWindow = pageWin;

export const isIsolatedContext = pageWin !== sandboxWin;

export const sandboxWindow = sandboxWin;

export function shareGlobal(name: string, value: any) {
  try {
    (pageWin as any)[name] = value;
  } catch {}
  if (isIsolatedContext) {
    try {
      (sandboxWin as any)[name] = value;
    } catch {}
  }
}

export function readSharedGlobal<T = any>(name: string): T | undefined {
  if (isIsolatedContext) {
    const sandboxValue = (sandboxWin as any)[name];
    if (sandboxValue !== undefined) return sandboxValue as T;
  }
  return (pageWin as any)[name] as T | undefined;
}
