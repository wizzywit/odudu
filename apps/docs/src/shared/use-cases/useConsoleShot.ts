import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  consoleShots,
  type ShotCatalogue,
  type ShotSize,
} from '@site/src/shared/services/consoleShot';

export interface ShotView {
  light: string;
  dark: string;
  size: ShotSize;
}

// The two captures of one picture, under the site's base address.
export function useShot(catalogue: ShotCatalogue, name: string): ShotView {
  const size = catalogue.sizeOf(name);
  return {
    light: useBaseUrl(catalogue.addressOf(name, 'light')),
    dark: useBaseUrl(catalogue.addressOf(name, 'dark')),
    size,
  };
}

// The two captures of one console page.
export function useConsoleShot(name: string): ShotView {
  return useShot(consoleShots, name);
}
