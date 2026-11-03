import { describe, expect, it } from 'vitest';
import { THEME_CHOICES, THEME_COOKIE, themeChoice, themeCookie } from '#/shared/lib/services/theme';

describe('the cookie that tells the server-rendered pages the choice', () => {
  it('names the cookie the server reads', () => {
    expect(THEME_COOKIE).toBe('odudu-theme');
  });

  it.each(['light', 'dark'] as const)('is kept for a year when %s is chosen', (choice) => {
    expect(themeCookie(choice, false)).toBe(
      `odudu-theme=${choice}; Path=/; SameSite=Lax; Max-Age=31536000`,
    );
  });

  it('is Secure when the page is served over https', () => {
    expect(themeCookie('dark', true)).toBe(
      'odudu-theme=dark; Path=/; SameSite=Lax; Max-Age=31536000; Secure',
    );
  });

  it('is cleared when the system is chosen, so the pages follow the system again', () => {
    expect(themeCookie('system', false)).toBe('odudu-theme=; Path=/; SameSite=Lax; Max-Age=0');
    expect(themeCookie('system', true)).toBe(
      'odudu-theme=; Path=/; SameSite=Lax; Max-Age=0; Secure',
    );
  });
});

describe('the theme choices', () => {
  it('are system, light and dark, in that order', () => {
    expect(THEME_CHOICES.map((c) => c.id)).toEqual(['system', 'light', 'dark']);
  });

  it('accepts a known choice and nothing else', () => {
    expect(themeChoice('dark')).toBe('dark');
    expect(themeChoice('sepia')).toBeUndefined();
    expect(themeChoice('light')).toBe('light');
    expect(themeChoice('system')).toBe('system');
    expect(themeChoice('')).toBeUndefined();
    expect(themeChoice('Dark')).toBeUndefined();
  });
});
