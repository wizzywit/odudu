import { useSyncExternalStore } from 'react';
import {
  prefersReducedMotion,
  serverReducedMotion,
  subscribeReducedMotion,
} from '@site/src/shared/platform/motion';

// Whether the reader asked for less motion; the server, which cannot know, says no.
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, serverReducedMotion);
}
