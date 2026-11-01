import { lookupLocalised } from '@odudu/contracts';

type Texts = Readonly<Record<string, string>>;

/**
 * What the consent page may show in a language other than the base text: the
 * client's own metadata, and a scope's wording, each by language tag.
 */
export interface ConsentI18n {
  readonly clientName: Texts;
  readonly scopeLabels: Readonly<Record<string, Texts>>;
}

export const NO_CONSENT_I18N: ConsentI18n = { clientName: {}, scopeLabels: {} };

export function consentClientName(base: string, i18n: ConsentI18n, tag: string): string {
  return lookupLocalised(i18n.clientName, tag) ?? base;
}

/**
 * The scope wording for a page language: the base consent text, over which
 * each scope's text for that language lays. A null-prototype record, so a
 * scope named like an object member is only ever a key.
 */
export function consentScopeTexts(
  base: Texts,
  i18n: ConsentI18n,
  tag: string,
): Readonly<Record<string, string>> {
  const texts: Record<string, string> = Object.assign(Object.create(null) as object, base);
  for (const [scope, byTag] of Object.entries(i18n.scopeLabels)) {
    const text = lookupLocalised(byTag, tag);
    if (text !== null) texts[scope] = text;
  }
  return texts;
}
