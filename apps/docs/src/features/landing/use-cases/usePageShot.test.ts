import { describe, expect, it } from 'vitest';
import { usePageShot } from '@site/src/features/landing/use-cases/usePageShot';
import { resultOf } from '@site/tests/support/hook';
import { PAGES_BASE } from '@site/site.config';

describe('usePageShot', () => {
  it('addresses both captures under the base address, with the captured size', () => {
    const shot = resultOf(() => usePageShot('sign-in'));
    expect(shot.light).toBe(`${PAGES_BASE}server-pages/sign-in-light.webp`);
    expect(shot.dark).toBe(`${PAGES_BASE}server-pages/sign-in-dark.webp`);
    expect(shot.size.width).toBe(460);
  });
});
