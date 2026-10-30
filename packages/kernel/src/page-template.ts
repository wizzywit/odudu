import { type PageKind } from '#/page-kinds';
import { type PageLocale } from '#/page';
import { fillTemplate } from '#/slots';

// A theme's template for `kind` when the locale carries one that still fills,
// else the package's default. A template saved against an older manifest or
// catalogue gives way to the default rather than a failed page, and the
// locale's `templateFallback` is told why. `text` throws for a key its
// catalogue lacks.
export function fillPageTemplate(
  kind: PageKind,
  defaultTemplate: string,
  parts: Readonly<Record<string, string>>,
  locale: PageLocale,
  text: (key: string) => string,
): string {
  const own = locale.branding?.templates[kind];
  if (own !== undefined) {
    try {
      return fillTemplate(own, parts, text);
    } catch (error) {
      locale.templateFallback?.(kind, error instanceof Error ? error.message : 'unfillable');
    }
  }
  return fillTemplate(defaultTemplate, parts, text);
}

export interface PageFillerOptions<K extends PageKind> {
  defaults: Readonly<Record<K, string>>;
  // Whether the package's catalogue holds `key`; a theme's `{{t "key"}}` for
  // one it lacks makes the template unfillable rather than the page fail.
  hasMessage: (key: string) => boolean;
  text: (locale: PageLocale, key: string) => string;
}

// The `fillPage` of a package: its own catalogue and default templates bound
// once. `parts` holds every name the kind's manifest lists, an empty string
// for one this render has nothing for, so a template may place any of them.
export function createPageFiller<K extends PageKind>(
  options: PageFillerOptions<K>,
): (kind: K, parts: Readonly<Record<string, string>>, locale: PageLocale) => string {
  return (kind, parts, locale) =>
    fillPageTemplate(kind, options.defaults[kind], parts, locale, (key) => {
      if (!options.hasMessage(key)) throw new Error(`unknown message ${key}`);
      return options.text(locale, key);
    });
}
