import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  pageShotAddress,
  pageShotSize,
  type PageShotSize,
} from '@site/src/features/landing/services/pageShot';

export interface PageShotView {
  light: string;
  dark: string;
  size: PageShotSize;
}

// The two captures of one server page, under the site's base address.
export function usePageShot(name: string): PageShotView {
  const size = pageShotSize(name);
  return {
    light: useBaseUrl(pageShotAddress(name, 'light')),
    dark: useBaseUrl(pageShotAddress(name, 'dark')),
    size,
  };
}
