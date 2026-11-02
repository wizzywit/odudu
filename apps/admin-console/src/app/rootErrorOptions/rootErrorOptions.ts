import { CatchBoundary } from '@tanstack/react-router';
import type { RootOptions } from 'react-dom/client';
import { caughtIsLogged, RootBoundary, recordFailure, type CaughtBy } from '#/features/failure';
import { ChunkLoadError } from '#/shared/services/chunkLoad';
import { ChunkBoundary } from '#/shared/ui/ChunkBoundary';

// The route's own and the root's boundaries draw an id and log it; the chunk
// boundary draws none; any other boundary is not ours to have an opinion on.
function caughtBy(boundary: unknown): CaughtBy {
  if (boundary instanceof CatchBoundary || boundary instanceof RootBoundary) return 'shows-id';
  return boundary instanceof ChunkBoundary ? 'chunk' : 'other';
}

// What React reports outside any panel, each with an id in its log line. An
// error React caught for a panel is the panel's to log, so it is not logged
// twice under two ids.
export function rootErrorOptions(route: () => string): RootOptions {
  return {
    onCaughtError: (error, { errorBoundary, componentStack }) => {
      if (caughtIsLogged(caughtBy(errorBoundary), error instanceof ChunkLoadError)) {
        recordFailure('caught', error, route(), componentStack);
      }
    },
    onUncaughtError: (error, { componentStack }) => {
      recordFailure('uncaught', error, route(), componentStack);
    },
    onRecoverableError: (error, { componentStack }) => {
      recordFailure('recoverable', error, route(), componentStack);
    },
  };
}
