import manifest from '@site/static/console/manifest.json';

export interface ShotSize {
  width: number;
  height: number;
}

const SIZES: Record<string, ShotSize> = manifest;

// The captured size of a console picture, from the manifest the capture wrote.
export function sizeOf(name: string): ShotSize {
  const size = SIZES[name];
  if (size === undefined) throw new Error(`no console capture named ${name}`);
  return size;
}

export function captureAddress(name: string, scheme: 'light' | 'dark'): string {
  return `/console/${name}-${scheme}.webp`;
}

export interface ShotLoading {
  fetchPriority: 'high' | undefined;
  loading: 'lazy' | undefined;
}

// The light capture is what a priority picture waits for; any other is fetched lazily.
export function loadingFor(priority: boolean): ShotLoading {
  return priority
    ? { fetchPriority: 'high', loading: undefined }
    : { fetchPriority: undefined, loading: 'lazy' };
}
