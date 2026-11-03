import { describe, expect, it } from 'vitest';
import { siteAddress } from '@site/src/features/landing/services/site';

describe('the site address', () => {
  it('is the origin followed by the base path', () => {
    expect(siteAddress({ url: 'https://example.test', baseUrl: '/base/' })).toBe(
      'https://example.test/base/',
    );
  });
});
