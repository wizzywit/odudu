import useBaseUrl from '@docusaurus/useBaseUrl';
import { captureAddress, sizeOf, type ShotSize } from '@site/src/shared/services/consoleShot';

export interface ConsoleShotView {
  light: string;
  dark: string;
  size: ShotSize;
}

// The two captures of one console page, under the site's base address.
export function useConsoleShot(name: string): ConsoleShotView {
  const size = sizeOf(name);
  return {
    light: useBaseUrl(captureAddress(name, 'light')),
    dark: useBaseUrl(captureAddress(name, 'dark')),
    size,
  };
}
