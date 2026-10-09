import { describe, expect, it } from 'vitest';
import { renderSignInRefused } from '#/view/refusal-html';

describe('renderSignInRefused', () => {
  it('says only that sign-in could not be completed, and carries no script', () => {
    const page = renderSignInRefused();
    expect(page.html).toContain('sign-in could not be completed');
    expect(page.script).toBeNull();
    expect(page.frames).toEqual([]);
  });

  it('offers one way out, back to the console, which begins a fresh sign-in', () => {
    const page = renderSignInRefused();
    expect(page.html).toContain('<a href="/console/">Sign in again</a>');
    expect(page.html.match(/<a /gu)).toHaveLength(1);
  });
});
