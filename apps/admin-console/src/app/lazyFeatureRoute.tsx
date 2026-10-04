import { lazy, Suspense, useState, type ComponentType } from 'react';
import { useReloadConsole } from '#/shared/repository/useReloadConsole.ts';
import { ChunkLoadError } from '#/shared/service/chunkLoad.ts';
import { ChunkBoundary } from '#/shared/view/ChunkBoundary.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';

export type FeatureRoute<P extends object> = ComponentType<P> & {
  // Fetches the chunk ahead of the first render, which then draws at once.
  preload: () => Promise<void>;
};

// A route whose component is a feature's own chunk, fetched on first use.
// TanStack's lazyRouteComponent is not used: on a stale chunk it writes
// sessionStorage and reloads past the unsaved-changes guard, which this
// asks first.
export function lazyFeatureRoute<P extends object>(
  load: () => Promise<ComponentType<P>>,
  label: string,
): FeatureRoute<P> {
  let fetching: Promise<ComponentType<P>> | null = null;
  let loaded: ComponentType<P> | null = null;
  const fetchOnce = (): Promise<ComponentType<P>> => {
    fetching ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        fetching = null;
        throw new ChunkLoadError(error);
      },
    );
    return fetching;
  };
  const Feature = lazy(() => fetchOnce().then((component) => ({ default: component })));
  function FeatureRoute(props: P) {
    const reload = useReloadConsole();
    // Chosen once per mount: switching from the lazy element to the loaded
    // one later would remount the feature and lose its state.
    const [Loaded] = useState(() => loaded);
    return (
      <ChunkBoundary onReload={reload}>
        {Loaded === null ? (
          <Suspense fallback={<Skeleton label={label} lines={4} />}>
            <Feature {...props} />
          </Suspense>
        ) : (
          <Loaded {...props} />
        )}
      </ChunkBoundary>
    );
  }
  return Object.assign(FeatureRoute, {
    preload: () => fetchOnce().then(() => undefined),
  });
}
