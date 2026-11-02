export function remember(): void {
  window.lastSeen = 1;
  (globalThis as Record<string, unknown>).seen = 1;
  window.location.href = '/elsewhere';
  window.onbeforeunload = null;
}
