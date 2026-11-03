import { PAGE_SHOTS, type PageShotCard } from '@site/src/features/landing/services/serverPageCards';
import manifest from '@site/static/server-pages/manifest.json';

export interface PageShotSize {
  width: number;
  height: number;
}

const SIZES: Record<string, PageShotSize & { hash: string }> = manifest;

export function pageShotSize(name: string): PageShotSize {
  const size = SIZES[name];
  if (size === undefined) throw new Error(`no server page capture named ${name}`);
  return { width: size.width, height: size.height };
}

export function pageShotAddress(name: string, scheme: 'light' | 'dark'): string {
  return `/server-pages/${name}-${scheme}.webp`;
}

export function shotsOfSize(size: PageShotCard['size']): PageShotCard[] {
  return PAGE_SHOTS.filter((shot) => shot.size === size);
}
