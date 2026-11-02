import { schedule } from '@site/src/shared/platform/timers';

// Runs `run` once the page is idle, or after `fallbackMs` where the browser has no idle callback;
// the returned function cancels it.
export function whenIdle(run: () => void, fallbackMs: number): () => void {
  if (typeof requestIdleCallback !== 'function') return schedule(run, fallbackMs);
  const handle = requestIdleCallback(run);
  return () => {
    cancelIdleCallback(handle);
  };
}
