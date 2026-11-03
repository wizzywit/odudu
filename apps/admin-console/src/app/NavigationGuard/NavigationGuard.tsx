import { useBlocker } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';

function askTheGuard(): Promise<boolean> {
  return new Promise((resolve) => {
    useUnsavedGuard.getState().request(
      () => {
        resolve(false);
      },
      () => {
        resolve(true);
      },
    );
  });
}

// Every route change, back and forward included, waits on the guard; a
// reload or a close can only be asked about by the browser's own prompt.
export function NavigationGuard() {
  const restore = useUnsavedGuard((guard) => guard.restore);
  useBlocker({ shouldBlockFn: askTheGuard, enableBeforeUnload: false });
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent): void => {
      const { dirty, released } = useUnsavedGuard.getState();
      if (dirty.size > 0 && !released) event.preventDefault();
    };
    const restored = (event: PageTransitionEvent): void => {
      if (event.persisted) restore();
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('pageshow', restored);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('pageshow', restored);
    };
  }, [restore]);
  return null;
}
