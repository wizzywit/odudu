import { describe, expect, it } from 'vitest';
import { useAssetUrls } from '@site/src/features/landing/use-cases/useAssetUrls';
import { resultOf } from '@site/tests/support/hook';
import { PAGES_BASE } from '@site/site.config';

describe('useAssetUrls', () => {
  it('addresses the files the build publishes beside the page', () => {
    expect(resultOf(useAssetUrls)).toEqual({
      llms: `${PAGES_BASE}llms.txt`,
      sansLicence: `${PAGES_BASE}licenses/IBM-Plex-Sans-OFL-1.1.txt`,
      monoLicence: `${PAGES_BASE}licenses/IBM-Plex-Mono-OFL-1.1.txt`,
    });
  });
});
