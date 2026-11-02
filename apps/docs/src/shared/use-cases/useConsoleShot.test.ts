import { describe, expect, it } from 'vitest';
import { useConsoleShot } from '@site/src/shared/use-cases/useConsoleShot';
import { resultOf } from '@site/tests/support/hook';
import { PAGES_BASE } from '@site/site.config';

describe('useConsoleShot', () => {
  it('gives the two captures and the size of one console page', () => {
    expect(resultOf(() => useConsoleShot('audit'))).toEqual({
      light: `${PAGES_BASE}console/audit-light.webp`,
      dark: `${PAGES_BASE}console/audit-dark.webp`,
      size: { width: 1100, height: 900 },
    });
  });
});
