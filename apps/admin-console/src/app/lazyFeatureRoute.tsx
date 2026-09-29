import { lazy, Suspense, type ComponentType } from 'react';
import { useReloadConsole } from '#/shared/repository/useReloadConsole.ts';
import { ChunkLoadError } from '#/shared/service/chunkLoad.ts';
import { ChunkBoundary } from '#/shared/view/ChunkBoundary.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';

// A route whose component is a feature's own chunk, fetched on first use.
// TanStack's lazyRouteComponent is not used: on a stale chunk it writes
// sessionStorage and reloads past the unsaved-changes guard, which this
// asks first.
export function lazyFeatureRoute<P extends object>(
  load: () => Promise<ComponentType<P>>,
  label: string,
): ComponentType<P> {
  const Feature = lazy(() =>
    load().then(
      (component) => ({ default: component }),
      (error: unknown) => {
        throw new ChunkLoadError(error);
      },
    ),
  );
  return function FeatureRoute(props: P) {
    const reload = useReloadConsole();
    return (
      <ChunkBoundary onReload={reload}>
        <Suspense fallback={<Skeleton label={label} lines={4} />}>
          <Feature {...props} />
        </Suspense>
      </ChunkBoundary>
    );
  };
}
