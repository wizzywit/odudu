import { describe, expect, it } from 'vitest';
import { consentClientName, consentScopeTexts, type ConsentI18n } from '#/service/consent-i18n';

const I18N: ConsentI18n = {
  clientName: { fr: 'Boutique', 'pt-BR': 'Loja' },
  scopeLabels: { profile: { fr: 'Votre profil' } },
};

describe('consentClientName', () => {
  it('picks the page language, by lookup', () => {
    expect(consentClientName('Shop', I18N, 'fr')).toBe('Boutique');
    expect(consentClientName('Shop', I18N, 'fr-CA')).toBe('Boutique');
  });

  it('falls back to the base name for a language with no entry', () => {
    expect(consentClientName('Shop', I18N, 'de')).toBe('Shop');
    expect(consentClientName('Shop', I18N, 'pt')).toBe('Shop');
  });
});

describe('consentScopeTexts', () => {
  it('overlays the page language on the base text, scope by scope', () => {
    expect(
      consentScopeTexts({ profile: 'Your profile', email: 'Your address' }, I18N, 'fr'),
    ).toEqual({ profile: 'Votre profil', email: 'Your address' });
  });

  it('names a scope that only has a translation', () => {
    expect(consentScopeTexts({}, I18N, 'fr-CA')).toEqual({ profile: 'Votre profil' });
  });

  it('keeps the base text for a language with no entry', () => {
    expect(consentScopeTexts({ profile: 'Your profile' }, I18N, 'de')).toEqual({
      profile: 'Your profile',
    });
  });

  it('is not led astray by a scope named like an object member', () => {
    const labels = consentScopeTexts(
      {},
      { clientName: {}, scopeLabels: { constructor: { en: 'x' } } },
      'en',
    );
    expect(Object.getPrototypeOf(labels)).toBeNull();
    expect(Object.hasOwn(labels, 'constructor')).toBe(true);
  });
});
