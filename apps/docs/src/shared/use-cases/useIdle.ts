import { useEffect, useEffectEvent } from 'react';
import { whenIdle } from '@site/src/shared/platform/idle';

// Starts `run` once the page is idle, while `enabled`, and stops what it
// started when `enabled` ends or the page goes. Where the browser has no idle
// callback the start is a short timer.
export function useIdle(enabled: boolean, fallbackMs: number, run: () => () => void): void {
  const begin = useEffectEvent(run);
  useEffect(() => {
    if (!enabled) return undefined;
    let stop: (() => void) | undefined;
    const cancel = whenIdle(() => {
      stop = begin();
    }, fallbackMs);
    return () => {
      cancel();
      stop?.();
    };
  }, [enabled, fallbackMs]);
}
