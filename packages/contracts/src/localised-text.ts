import { containsBidiControl, BIDI_REFUSED_MESSAGE } from '#/bidi';
import { canonicalLocale } from '#/profile-claims';

/** The most languages one text carries; the tenant's own list is held to the same number. */
export const LOCALISED_TEXT_ENTRIES_MAX = 32;

export type LocalisedText = Record<string, string>;

export type LocalisedTextCheck =
  { kind: 'ok'; value: LocalisedText } | { kind: 'invalid'; message: string };

export interface LocalisedTextOptions {
  /** The longest value, which is the base column's own limit. */
  readonly max: number;
  /** The tenant's languages; absent, any well-formed tag is accepted. */
  readonly supported?: readonly string[];
  /** What is stored now, so a value already held never blocks an unrelated edit. */
  readonly current?: Readonly<Record<string, string>>;
}

function invalid(message: string): LocalisedTextCheck {
  return { kind: 'invalid', message };
}

// A refusal names the field and the position, never the key itself: the key
// is whatever the caller sent.
function checkEntry(
  field: string,
  tag: string,
  text: unknown,
  options: LocalisedTextOptions,
): string | null {
  if (typeof text !== 'string' || text.length === 0) {
    return `${field} values must be non-empty strings`;
  }
  if (text.length > options.max) {
    return `${field} values must be at most ${String(options.max)} characters`;
  }
  const held = options.current === undefined ? undefined : options.current[tag];
  if (text !== held && containsBidiControl(text)) {
    return `${field} values ${BIDI_REFUSED_MESSAGE}`;
  }
  return null;
}

/**
 * A map of text by language tag as a caller supplies it, held to what the
 * columns and the pages assume: tags in the canonical spelling and each once,
 * at most `LOCALISED_TEXT_ENTRIES_MAX` of them, each inside the tenant's list
 * when one is given, each value held to the base column's limit and character
 * rules.
 */
export function checkLocalisedText(
  field: string,
  value: unknown,
  options: LocalisedTextOptions,
): LocalisedTextCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${field} must be an object of text by language tag`);
  }
  const keys = Object.keys(value);
  if (keys.length > LOCALISED_TEXT_ENTRIES_MAX) {
    return invalid(`${field} holds at most ${String(LOCALISED_TEXT_ENTRIES_MAX)} languages`);
  }
  const supported =
    options.supported === undefined
      ? null
      : new Set(options.supported.map((tag) => canonicalLocale(tag) ?? tag));
  const checked: LocalisedText = {};
  for (const key of keys) {
    const tag = canonicalLocale(key);
    if (tag === null) return invalid(`${field} has a key that is not a language tag`);
    if (Object.hasOwn(checked, tag)) return invalid(`${field} names ${tag} more than once`);
    if (supported !== null && !supported.has(tag)) {
      return invalid(`${field} names ${tag}, which is not one of the tenant's supported_locales`);
    }
    const text: unknown = Reflect.get(value, key);
    const problem = checkEntry(field, tag, text, options);
    if (problem !== null) return invalid(problem);
    checked[tag] = text as string;
  }
  return { kind: 'ok', value: checked };
}

/**
 * The text for a language by RFC 4647 §3.4 lookup: the tag, then the tag with
 * its last subtag dropped, until one has an entry. Null when none does, and
 * the base column answers.
 */
export function lookupLocalised(map: Readonly<Record<string, string>>, tag: string): string | null {
  const canonical = canonicalLocale(tag);
  if (canonical === null) return null;
  const parts = canonical.split('-');
  for (let length = parts.length; length > 0; length -= 1) {
    const candidate = parts.slice(0, length).join('-');
    if (Object.hasOwn(map, candidate)) return map[candidate] ?? null;
  }
  return null;
}
