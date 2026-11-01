import { expect, it } from 'vitest';
import { offeredBy, translationsPatch } from '#/features/clients/service/translations';

it('sends the name and the description map that changed, each whole', () => {
  expect(translationsPatch({ name_i18n: { fr: 'Facturation' } })).toEqual({
    name_i18n: { fr: 'Facturation' },
  });
  expect(translationsPatch({ name_i18n: {}, description_i18n: { de: 'Rechnungen' } })).toEqual({
    name_i18n: {},
    description_i18n: { de: 'Rechnungen' },
  });
});

it('sends nothing for a map that was not touched', () => {
  expect(translationsPatch({})).toEqual({});
});

it('offers the languages the client’s record carries', () => {
  expect(offeredBy({ supported_locales: ['en', 'fr'] })).toEqual({
    status: 'ready',
    data: ['en', 'fr'],
  });
});
