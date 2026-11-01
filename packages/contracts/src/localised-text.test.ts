import { describe, expect, it } from 'vitest';
import { checkLocalisedText, LOCALISED_TEXT_ENTRIES_MAX, lookupLocalised } from '#/localised-text';

const OPTIONS = { max: 20 } as const;

describe('checkLocalisedText', () => {
  it('accepts a map and spells its keys canonically', () => {
    expect(checkLocalisedText('name_i18n', { fr: 'Mon app', 'pt-br': 'Meu app' }, OPTIONS)).toEqual(
      { kind: 'ok', value: { fr: 'Mon app', 'pt-BR': 'Meu app' } },
    );
  });

  it('accepts an empty map', () => {
    expect(checkLocalisedText('name_i18n', {}, OPTIONS)).toEqual({ kind: 'ok', value: {} });
  });

  it.each([null, 'fr', 3, ['fr'], undefined])('refuses %j, which is not an object', (value) => {
    expect(checkLocalisedText('name_i18n', value, OPTIONS).kind).toBe('invalid');
  });

  it.each(['', 'e', 'english', 'en_US', '__proto__', '<script>', 'fr-CAN-x', 'constructor'])(
    'refuses the key %j',
    (key) => {
      const body = JSON.parse(`{${JSON.stringify(key)}: "x"}`) as unknown;
      expect(checkLocalisedText('name_i18n', body, OPTIONS).kind).toBe('invalid');
    },
  );

  it('refuses two keys that are one tag spelled differently', () => {
    const checked = checkLocalisedText('name_i18n', { 'fr-ca': 'a', 'fr-CA': 'b' }, OPTIONS);
    expect(checked).toMatchObject({ kind: 'invalid' });
  });

  it('refuses a 33rd entry', () => {
    const tags = Array.from(
      { length: LOCALISED_TEXT_ENTRIES_MAX + 1 },
      (_, i) =>
        `x${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
    );
    const map = Object.fromEntries(tags.map((tag) => [tag, 'a']));
    expect(checkLocalisedText('name_i18n', map, OPTIONS).kind).toBe('invalid');
    const thirtyTwo = Object.fromEntries(tags.slice(0, 32).map((tag) => [tag, 'a']));
    expect(checkLocalisedText('name_i18n', thirtyTwo, OPTIONS).kind).toBe('ok');
  });

  it('refuses a key outside the supported list, in any spelling', () => {
    const supported = ['en', 'fr', 'pt-BR'];
    expect(checkLocalisedText('name_i18n', { de: 'a' }, { ...OPTIONS, supported }).kind).toBe(
      'invalid',
    );
    expect(checkLocalisedText('name_i18n', { 'pt-br': 'a' }, { ...OPTIONS, supported }).kind).toBe(
      'ok',
    );
  });

  it.each([1, null, '', {}, ['a']])('refuses the value %j', (value) => {
    expect(checkLocalisedText('name_i18n', { fr: value }, OPTIONS).kind).toBe('invalid');
  });

  it('refuses a value over the limit, and accepts one at it', () => {
    expect(checkLocalisedText('name_i18n', { fr: 'a'.repeat(21) }, OPTIONS).kind).toBe('invalid');
    expect(checkLocalisedText('name_i18n', { fr: 'a'.repeat(20) }, OPTIONS).kind).toBe('ok');
  });

  it('refuses a bidirectional control, unless the same text is already stored', () => {
    const text = 'a‮b';
    expect(checkLocalisedText('name_i18n', { fr: text }, OPTIONS).kind).toBe('invalid');
    expect(
      checkLocalisedText('name_i18n', { fr: text }, { ...OPTIONS, current: { fr: text } }).kind,
    ).toBe('ok');
  });

  it('names the field in a refusal', () => {
    const checked = checkLocalisedText('consent_text_i18n', { fr: 1 }, OPTIONS);
    expect(checked).toMatchObject({ kind: 'invalid' });
    expect(checked.kind === 'invalid' && checked.message).toContain('consent_text_i18n');
  });
});

describe('lookupLocalised', () => {
  const map = { fr: 'Français', 'pt-BR': 'Brasil', 'zh-Hant': 'Hant' };

  it('finds the exact tag', () => {
    expect(lookupLocalised(map, 'fr')).toBe('Français');
  });

  it('drops subtags from the right until one matches (RFC 4647 lookup)', () => {
    expect(lookupLocalised(map, 'fr-CA')).toBe('Français');
    expect(lookupLocalised(map, 'zh-Hant-TW')).toBe('Hant');
  });

  it('does not widen a language to a region', () => {
    expect(lookupLocalised(map, 'pt')).toBeNull();
  });

  it('compares case-insensitively', () => {
    expect(lookupLocalised(map, 'FR-ca')).toBe('Français');
  });

  it('answers null for no match and for a tag that is not one', () => {
    expect(lookupLocalised(map, 'de')).toBeNull();
    expect(lookupLocalised(map, '__proto__')).toBeNull();
    expect(lookupLocalised({}, 'fr')).toBeNull();
  });

  it('never reads an inherited property', () => {
    expect(lookupLocalised({}, 'constructor')).toBeNull();
  });
});
