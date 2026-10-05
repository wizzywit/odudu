import { useBlocker } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

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
  useBlocker({ shouldBlockFn: askTheGuard, enableBeforeUnload: false });
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent): void => {
      const { dirty, released } = useUnsavedGuard.getState();
      if (dirty.size > 0 && !released) event.preventDefault();
    };
    const restored = (event: PageTransitionEvent): void => {
      if (event.persisted) useUnsavedGuard.setState({ released: false });
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('pageshow', restored);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('pageshow', restored);
    };
  }, []);
  return null;
}
