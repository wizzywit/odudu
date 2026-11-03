import { counted } from '#/shared/lib/services/format';
import { OVERRIDE_CAP } from '#/pages/branding/services/overrideForm';

// How many are shown, said as a total only once no page is left to load.
export function capText(loaded: number, more: boolean): string {
  const shown = counted(loaded, 'override', 'overrides');
  const held = `The tenant may hold ${String(OVERRIDE_CAP)} across every language.`;
  return more
    ? `${shown} loaded so far; more follow. ${held}`
    : `${shown} in this language. ${held}`;
}

// The page size of the table; the server pages at most 200.
export const PAGE_SIZE = 50;

// The language the table shows: the one picked while it is still offered.
export function shownLocale(
  picked: string | null,
  supported: readonly string[],
  opening: string,
): string {
  return picked !== null && supported.includes(picked) ? picked : opening;
}
