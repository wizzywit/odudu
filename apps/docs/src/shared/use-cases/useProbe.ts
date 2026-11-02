import { useSyncExternalStore } from 'react';
import { absent, subscribeNever } from '@site/src/shared/platform/page';

// A fact about the browser that does not change after load. The server and the
// first client render both say no, so markup matches; the browser's answer follows.
export function useProbe(probe: () => boolean): boolean {
  return useSyncExternalStore(subscribeNever, probe, absent);
}
