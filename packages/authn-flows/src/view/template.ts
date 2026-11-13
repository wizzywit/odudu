import { fillPageTemplate } from '@odudu/kernel';
import { en, t, type MessageId } from '#/view/messages';
import { DEFAULT_TEMPLATES, type TemplatedKind } from '#/view/templates/index';

// Whether the package's catalogue holds `key`: what a theme's `{{t "key"}}` is
// checked against when it is saved.
export const hasMessage = (key: string): boolean => Object.hasOwn(en, key);

// A sentence the template names, said another way for this render: the
// template, a theme's included, is the same; `from` reads as `to`.
export interface SaidInstead {
  from: MessageId;
  to: MessageId;
}

export function fillPage(
  kind: TemplatedKind,
  parts: Readonly<Record<string, string>>,
  locale: Parameters<typeof t>[0],
  said?: SaidInstead,
): string {
  return fillPageTemplate(kind, DEFAULT_TEMPLATES[kind], parts, locale, (key) => {
    // Checked by `hasMessage` first, so the key is one of the catalogue's.
    if (!hasMessage(key)) throw new Error(`unknown message ${key}`);
    return t(locale, key === said?.from ? said.to : (key as MessageId));
  });
}
