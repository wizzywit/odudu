import { describe, expect, it } from 'vitest';
import { offeredLocales } from '#/shared/service/offeredLocales';

describe('the languages a tenant offers', () => {
  it('reads supported_locales out of the settings record', () => {
    expect(offeredLocales({ supported_locales: ['en', 'fr', 'pt-BR'] })).toEqual([
      'en',
      'fr',
      'pt-BR',
    ]);
  });

  it('keeps only the tags, and offers none when the setting is not a list', () => {
    expect(offeredLocales({ supported_locales: ['en', 3, null, 'fr'] })).toEqual(['en', 'fr']);
    expect(offeredLocales({ supported_locales: 'en' })).toEqual([]);
    expect(offeredLocales({})).toEqual([]);
  });
});
