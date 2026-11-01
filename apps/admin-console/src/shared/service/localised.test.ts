import { describe, expect, it } from 'vitest';
import {
  describeTranslations,
  isTranslated,
  languagesNote,
  LANGUAGES_FAILED,
  LANGUAGES_REFUSED,
  LOADING_LANGUAGES,
  NONE_TRANSLATED,
  offeredOf,
  offersTag,
  translatedSummary,
  translationTabs,
  withTranslation,
} from '#/shared/service/localised';

const retry = () => undefined;

describe('the languages a text is translated into', () => {
  it('has a tab for each offered language, then each other the map holds, once', () => {
    expect(translationTabs(['fr', 'de'], { de: 'x', es: 'y' })).toEqual(['fr', 'de', 'es']);
    expect(translationTabs([], {})).toEqual([]);
  });

  it('sets one language and leaves the rest', () => {
    expect(withTranslation({ fr: 'a' }, 'de', 'b')).toEqual({ fr: 'a', de: 'b' });
    expect(withTranslation({ fr: 'a' }, 'fr', 'c')).toEqual({ fr: 'c' });
  });

  it('removes the entry when the text is blank, since a blank is no translation', () => {
    expect(withTranslation({ fr: 'a', de: 'b' }, 'fr', '')).toEqual({ de: 'b' });
    expect(withTranslation({ fr: 'a' }, 'fr', '   ')).toEqual({});
  });

  it('says what is translated by language name, or that nothing is', () => {
    expect(translatedSummary({ fr: 'a', de: 'b' })).toBe(
      'Translated: French (fr) and German (de). Every other language shows the text above.',
    );
    expect(translatedSummary({})).toBe(NONE_TRANSLATED);
  });

  it('tells a translation from a blank', () => {
    expect(isTranslated({ fr: 'a' }, 'fr')).toBe(true);
    expect(isTranslated({ fr: ' ' }, 'fr')).toBe(false);
    expect(isTranslated({}, 'fr')).toBe(false);
  });
});

it('names the languages a map holds for a conflict, or none', () => {
  expect(describeTranslations({ fr: 'a', de: 'b' })).toBe('fr, de');
  expect(describeTranslations({})).toBe('none');
  expect(describeTranslations(undefined)).toBe('none');
});

describe('the offered languages as a read', () => {
  it('says nothing once they are known, and why not before', () => {
    expect(languagesNote({ status: 'ready', data: ['en'] })).toBeNull();
    expect(languagesNote({ status: 'loading' })).toBe(LOADING_LANGUAGES);
    expect(languagesNote({ status: 'failed', refused: true, retry })).toBe(LANGUAGES_REFUSED);
    expect(languagesNote({ status: 'failed', refused: false, retry })).toBe(LANGUAGES_FAILED);
  });

  it('offers none until they are known, and takes any tag as offered meanwhile', () => {
    expect(offeredOf({ status: 'ready', data: ['en', 'fr'] })).toEqual(['en', 'fr']);
    expect(offeredOf({ status: 'loading' })).toEqual([]);
    expect(offersTag({ status: 'ready', data: ['en'] }, 'fr')).toBe(false);
    expect(offersTag({ status: 'ready', data: ['en', 'fr'] }, 'fr')).toBe(true);
    expect(offersTag({ status: 'loading' }, 'fr')).toBe(true);
  });
});
