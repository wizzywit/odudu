export function lazily<T>(load: () => Promise<T>) {
  let fetching: Promise<T> | null = null;
  let loaded: T | null = null;
  const fetchOnce = (): Promise<T> => {
    fetching ??= load().then(
      (value) => {
        loaded = value;
        return value;
      },
      (error: unknown) => {
        fetching = null;
        throw error;
      },
    );
    return fetching;
  };
  return {
    preload: () => fetchOnce().then(() => undefined),
    current: () => loaded,
  };
}

export const route = lazily(() => import('./methods'));
