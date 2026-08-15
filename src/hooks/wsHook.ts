// src/hooks/wsHook.ts
// Minimal socket-capture shim, trimmed from the full mod's hooks/ws-hook.ts.
//
// sendToGame() (src/core/sendToGame.ts) needs a live page WebSocket to write
// the "Wish" command to. The game doesn't expose that socket anywhere else,
// so this wraps the page's native WebSocket constructor to capture every
// instance into `sockets`, and flags the one that looks like the game's own
// connection (first to go OPEN, or the first to emit a Welcome/Config/state
// message) via `setQWS`. Everything else the full mod's hook does
// (auto-reconnect, version-expired auto-reload, command interceptors) is
// unrelated to deleting seeds and is left out.
import { NativeWS, sockets, setQWS } from "../core/state";
import { pageWindow } from "../utils/page-context";
import { parseWSData } from "../core/parse";

export function installPageWebSocketHook() {
  if (!pageWindow || !NativeWS) return;

  function WrappedWebSocket(this: any, url: string | URL, protocols?: string | string[]) {
    const ws: WebSocket =
      protocols !== undefined
        ? new NativeWS(url as any, protocols)
        : new NativeWS(url as any);
    sockets.push(ws);

    ws.addEventListener("open", () => {
      setTimeout(() => {
        if ((ws as any).readyState === NativeWS.OPEN) setQWS(ws, "open-fallback");
      }, 800);
    });

    ws.addEventListener("message", async (ev: MessageEvent) => {
      const j = await parseWSData(ev.data);
      if (!j) return;
      if (j.type === "Welcome" || j.type === "Config" || j.fullState || j.config) {
        setQWS(ws, "message:" + (j.type || "state"));
      }
    });

    return ws;
  }

  (WrappedWebSocket as any).prototype = NativeWS.prototype;
  try { (WrappedWebSocket as any).OPEN = (NativeWS as any).OPEN; } catch {}
  try { (WrappedWebSocket as any).CLOSED = (NativeWS as any).CLOSED; } catch {}
  try { (WrappedWebSocket as any).CLOSING = (NativeWS as any).CLOSING; } catch {}
  try { (WrappedWebSocket as any).CONNECTING = (NativeWS as any).CONNECTING; } catch {}

  (pageWindow as any).WebSocket = WrappedWebSocket as any;
  if (pageWindow !== window) {
    try { (window as any).WebSocket = WrappedWebSocket as any; } catch {}
  }

  // Fallback: if no socket ever looked like the game's own connection (the
  // page's own RoomConnection wrapper still holds a reference to it even
  // when our heuristics above miss), grab it directly after a grace period.
  const FALLBACK_DELAY_MS = 5000;
  const win = pageWindow || (typeof window !== "undefined" ? window : null);
  if (win) {
    win.setTimeout(() => {
      try {
        const conn = (win as any).MagicCircle_RoomConnection;
        const ws: WebSocket | undefined = conn?.currentWebSocket;
        if (ws && ws.readyState === NativeWS.OPEN) {
          setQWS(ws, "room-connection-fallback");
        }
      } catch {}
    }, FALLBACK_DELAY_MS);
  }
}
