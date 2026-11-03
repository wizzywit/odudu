import { platformOf, type Platform } from '#/shared/lib/services/platform';

// Read once: the platform does not change under a page.
export const PLATFORM: Platform = platformOf(
  typeof navigator === 'undefined' ? undefined : navigator,
);
