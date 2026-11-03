import { describe, expect, it } from 'vitest';
import { useLandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { resultOf } from '@site/tests/support/hook';

describe('useLandingPage', () => {
  it('is not in motion on the server, and describes the site from its address', () => {
    const page = resultOf(useLandingPage);
    expect(page.motion).toBe(false);
    expect(page.jsonLd).toContain('https://example.test/odudu/');
    expect(page.jsonLd).not.toContain('<');
  });

  it('carries the motion, the mark the stylesheet reads and the description, and no more', () => {
    const page = resultOf(useLandingPage);
    expect(Object.keys(page).sort()).toEqual(['jsonLd', 'mark', 'motion']);
    expect(page.mark).toBeUndefined();
  });
});
