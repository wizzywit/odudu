import manifest from '@site/static/console/manifest.json';
import { shotCatalogue } from '@site/src/shared/lib/services/pictureShot';

export const consoleShots = shotCatalogue({
  manifest,
  directory: '/console',
  noun: 'console capture',
});

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
