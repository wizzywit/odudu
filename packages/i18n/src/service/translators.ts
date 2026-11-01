import {
  createCatalogue,
  type Catalogue,
  type Messages,
  type MessageValues,
} from '#/service/catalogue';
import { formatOverride } from '#/service/override';
import { type PageLocale } from '#/service/negotiate';

// A user's own text goes into a message as a marker the escaped result is
// searched for, so the whole message is escaped once and each isolated value
// is escaped once, inside its own <bdi>.
const OPEN = '';
const CLOSE = '';
const MARKER = /([^]*)/gu;

// A plain value is never allowed to carry the markers, so it cannot name an
// isolated slot of its own.
function withoutMarkers(values: MessageValues): MessageValues {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === 'string' ? value.replace(/[]/gu, '') : value,
    ]),
  );
}

export interface Translators<T extends Record<string, string>> {
  readonly catalogue: Catalogue<T>;
  // Plain text, for a title the shell escapes and for tests.
  readonly t: (locale: PageLocale, id: keyof T & string, values?: MessageValues) => string;
  // Escaped markup for a body; each `isolated` value is wrapped in <bdi>.
  readonly tHtml: (
    locale: PageLocale,
    id: keyof T & string,
    values?: MessageValues,
    isolated?: Readonly<Record<string, string>>,
  ) => string;
  // Wraps text somebody else wrote (a client's name, an account name, an
  // administrator's label) so its direction cannot reorder the text around it.
  readonly bdi: (value: string) => string;
}

// `escape` is the calling package's own HTML escaper, so every package keeps
// the one escaping function its renderers already use.
export function createTranslators<T extends Record<string, string>>(
  byLocale: Messages<T>,
  escape: (value: string) => string,
): Translators<T> {
  const catalogue = createCatalogue<T>(byLocale);
  const bdi = (value: string): string => `<bdi>${escape(value)}</bdi>`;
  const t: Translators<T>['t'] = (locale, id, values) =>
    (locale.overrides === undefined
      ? null
      : formatOverride(locale.overrides, locale.tag, id, values)) ??
    catalogue.format(locale.tag, id, values);
  const tHtml: Translators<T>['tHtml'] = (locale, id, values = {}, isolated = {}) => {
    const markers = Object.fromEntries(
      Object.keys(isolated).map((name) => [name, `${OPEN}${name}${CLOSE}`]),
    );
    return escape(t(locale, id, { ...withoutMarkers(values), ...markers })).replace(
      MARKER,
      (_, name: string) => (Object.hasOwn(isolated, name) ? bdi(isolated[name] ?? '') : ''),
    );
  };
  return { catalogue, t, tHtml, bdi };
}
