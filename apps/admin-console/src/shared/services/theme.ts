export type ThemeChoice = 'light' | 'dark' | 'system';

// The server-rendered pages run no script, so they read the choice from this
// cookie. A preference, neither secret nor identifier, hence readable by the
// pages and not HttpOnly; `system` clears it so those pages follow the
// operating system again.
export const THEME_COOKIE = 'odudu-theme';

const ONE_YEAR_SECONDS = 31_536_000;

export function themeCookie(choice: ThemeChoice, secure: boolean): string {
  const [value, maxAge] = choice === 'system' ? ['', 0] : [choice, ONE_YEAR_SECONDS];
  return [
    `${THEME_COOKIE}=${value}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${String(maxAge)}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
