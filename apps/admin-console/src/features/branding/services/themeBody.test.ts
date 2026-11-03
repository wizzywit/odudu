import type { ThemeView } from '#/features/branding/types/theme';
import { describe, expect, it } from 'vitest';
import { baseBody } from '#/features/branding/services/themeBody';
import { EMPTY, themeView } from '#/testing/brandingFixtures';

const view = (changes: Record<string, unknown> = {}) => themeView(changes) as ThemeView;

describe('what a save starts from', () => {
  it('is the draft, else the published theme, else nothing', () => {
    const published = {
      id: 'v',
      version: 1,
      published_at: null,
      body: { ...EMPTY, stylesheet: 'a{}' },
    };
    expect(baseBody(view())).toEqual(EMPTY);
    expect(baseBody(view({ published })).stylesheet).toBe('a{}');
    expect(baseBody(view({ published, draft: { ...EMPTY, stylesheet: 'b{}' } })).stylesheet).toBe(
      'b{}',
    );
  });
});
