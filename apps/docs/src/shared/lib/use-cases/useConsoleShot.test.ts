import { describe, expect, it } from 'vitest';
import { useConsoleShot } from '@site/src/shared/lib/use-cases/useConsoleShot';
import { resultOf } from '@site/tests/support/hook';
import { PAGES_BASE } from '@site/site.config';

describe('useConsoleShot', () => {
  it('gives the two captures and the size of one console page', () => {
    expect(resultOf(() => useConsoleShot('audit', false))).toEqual({
      shot: {
        light: `${PAGES_BASE}console/audit-light.webp`,
        dark: `${PAGES_BASE}console/audit-dark.webp`,
        size: { width: 1100, height: 900 },
      },
      loading: { fetchPriority: undefined, loading: 'lazy' },
    });
  });

  it('asks for the light capture first when the page is waiting for it', () => {
    const shot = resultOf(() => useConsoleShot('audit', true));
    expect(shot.loading).toEqual({ fetchPriority: 'high', loading: undefined });
  });
});
