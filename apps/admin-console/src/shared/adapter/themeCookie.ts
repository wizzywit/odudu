import { readThemeChoice } from '#/shared/adapter/themeChoice';
import type { ThemeChoice } from '#/shared/services/theme';
import { themeCookie } from '#/shared/services/theme';

export function writeThemeCookie(choice: ThemeChoice): void {
  try {
    document.cookie = themeCookie(choice, window.location.protocol === 'https:');
  } catch {
    // Without the cookie the server pages follow the system; the console
    // itself is unaffected.
  }
}

// At start: the stored choice becomes the cookie, unless storage cannot be
// read, when the cookie an earlier page wrote stands.
export function restoreThemeCookie(): void {
  const choice = readThemeChoice();
  if (choice !== undefined) writeThemeCookie(choice);
}
