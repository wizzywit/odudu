import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, themeCookie } from '#/shared/services/theme';

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
