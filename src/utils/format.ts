const NF_US = new Intl.NumberFormat("en-US");
export const formatNum = (n: number) => NF_US.format(Math.max(0, Math.floor(n || 0)));

export const EXTRA_ESTIMATE_BUFFER_PER_DELETE_MS = 10;

export function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  return `${Math.round(seconds)} s`;
}

export function formatFinishTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
