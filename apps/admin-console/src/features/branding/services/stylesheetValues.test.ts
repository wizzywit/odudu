import type { ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { stylesheetRequest, stylesheetValues } from '#/features/branding/services/stylesheetValues';
import { draftedView, EMPTY, themeView } from '#/testing/brandingFixtures';

describe('the stylesheet in a request', () => {
  it('is none when empty, and is carried with the rest of the draft', () => {
    const view = draftedView() as ThemeView;
    expect(stylesheetValues(themeView() as ThemeView)).toEqual({ stylesheet: '' });
    const request = stylesheetRequest(view, { stylesheet: 'a { color: red }' });
    expect(request.stylesheet).toBe('a { color: red }');
    expect(request.tokens).toEqual(view.draft?.tokens);
    expect(stylesheetRequest(view, { stylesheet: '  \n' }).stylesheet).toBeNull();
  });

  it('reads the draft’s stylesheet back', () => {
    const view = themeView({ draft: { ...EMPTY, stylesheet: 'a {}' } }) as ThemeView;
    expect(stylesheetValues(view)).toEqual({ stylesheet: 'a {}' });
  });
});
