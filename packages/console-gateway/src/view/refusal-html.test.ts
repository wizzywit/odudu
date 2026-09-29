import { describe, expect, it } from 'vitest';
import { renderSignInRefused } from '#/view/refusal-html';

describe('renderSignInRefused', () => {
  it('says only that sign-in could not be completed, and carries no script', () => {
    const page = renderSignInRefused();
    expect(page.html).toContain('sign-in could not be completed');
    expect(page.script).toBeNull();
    expect(page.frames).toEqual([]);
  });
});
