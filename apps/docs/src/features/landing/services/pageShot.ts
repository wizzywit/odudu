import { shotCatalogue } from '@site/src/shared/lib/services/pictureShot';
import { PAGE_SHOTS, type PageShotCard } from '@site/src/features/landing/services/serverPageCards';
import manifest from '@site/static/server-pages/manifest.json';

export const pageShots = shotCatalogue({
  manifest,
  directory: '/server-pages',
  noun: 'server page capture',
});

export function shotsOfSize(size: PageShotCard['size']): PageShotCard[] {
  return PAGE_SHOTS.filter((shot) => shot.size === size);
}
