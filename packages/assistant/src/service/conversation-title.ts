import { createMasker, MASKED } from '#/service/mask-secrets';

/** The longest title, in characters, which the list shows on one line. */
export const TITLE_MAX = 60;

const URLS = /\b(?:https?|ftp):\/\/\S+|\bwww\.\S+/giu;
const ADDRESSES = /[A-Za-z0-9._%+*-]{1,64}@[A-Za-z0-9.-]{1,255}/gu;
const LONG_DIGITS = /\d[\d\s.-]{4,}\d/gu;
const MASKED_ALL = new RegExp(MASKED.replace(/[[\]]/gu, '\\$&'), 'gu');

/**
 * What a conversation is called in its owner's list, from the first thing they
 * asked: the first line, with every address, link, long number and secret taken
 * out, cut at TITLE_MAX characters. `null` when nothing readable is left, and
 * the conversation then stays untitled. It is text derived from what the person
 * wrote, shown to them and, where the tenant allows, to its auditors.
 */
export function titleOf(text: string): string | null {
  const masked = createMasker({ emails: true }).mask(text);
  const source = typeof masked === 'string' ? masked : '';
  const line =
    source
      .split(/\r?\n/u)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? '';
  const cleaned = line
    .replace(URLS, ' ')
    .replace(ADDRESSES, ' ')
    .replace(LONG_DIGITS, ' ')
    .replace(MASKED_ALL, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (cleaned.length === 0) return null;
  const points = Array.from(cleaned);
  if (points.length <= TITLE_MAX) return cleaned;
  return `${points
    .slice(0, TITLE_MAX - 1)
    .join('')
    .trimEnd()}…`;
}
