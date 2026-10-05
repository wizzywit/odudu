import { describe, expect, it } from 'vitest';
import { themeChoice, THEME_CHOICES } from '#/features/shell/service/theme.ts';

describe('the theme choices', () => {
  it('are system, light and dark, in that order', () => {
    expect(THEME_CHOICES.map((c) => c.id)).toEqual(['system', 'light', 'dark']);
  });

  it('accepts a known choice and nothing else', () => {
    expect(themeChoice('dark')).toBe('dark');
    expect(themeChoice('sepia')).toBeUndefined();
  });
});
