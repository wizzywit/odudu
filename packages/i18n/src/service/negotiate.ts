import { isValidLocale } from '@odudu/contracts';
import { directionOf } from '#/service/direction';

export interface PageLocale {
  readonly tag: string;
  readonly dir: 'ltr' | 'rtl';
  // The tenant's own text for catalogue keys in `tag`, read before the
  // catalogue.
  readonly overrides?: Readonly<Record<string, string>>;
}

export interface NegotiationInput {
  readonly uiLocales: readonly string[];
  readonly subjectLocale: string | null;
  readonly authenticated: boolean;
  readonly tenantDefault: string | null;
  readonly acceptLanguage: string | null;
  readonly supported: readonly string[];
}

const FALLBACK = 'en';
const MAX_ACCEPT_ENTRIES = 16;
const MAX_ACCEPT_BYTES = 1024;
const SCRIPT = /^[A-Za-z]{4}$/u;
const REGION = /^(?:[A-Za-z]{2}|[0-9]{3})$/u;
const QUALITY = /^q=(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/u;

// RFC 4647 lowercasing is only for comparison; the supported list's own
// spelling is what leaves this module.
function fold(tag: string): string {
  return tag.toLowerCase();
}

// Reduces a tag to language[-script][-region], dropping variant and extension
// subtags, and returns null when what is left fails the shared locale shape.
function reduce(tag: string): string | null {
  const [language = '', ...rest] = tag.split('-');
  const kept = [language];
  const script = rest[0];
  if (script !== undefined && SCRIPT.test(script)) {
    kept.push(script);
    rest.shift();
  }
  const region = rest[0];
  if (region !== undefined && REGION.test(region)) kept.push(region);
  const reduced = kept.join('-');
  return isValidLocale(reduced) ? reduced : null;
}

function truncations(reduced: string): string[] {
  const parts = reduced.split('-');
  const out: string[] = [];
  for (let length = parts.length; length > 0; length -= 1) {
    out.push(parts.slice(0, length).join('-'));
  }
  return out;
}

function lookup(tag: string, supported: ReadonlyMap<string, string>): string | null {
  const reduced = reduce(tag);
  if (reduced === null) return null;
  for (const candidate of truncations(reduced)) {
    const match = supported.get(fold(candidate));
    if (match !== undefined) return match;
  }
  return null;
}

function boundedHeader(header: string): string {
  const bytes = new TextEncoder().encode(header);
  if (bytes.length <= MAX_ACCEPT_BYTES) return header;
  return new TextDecoder().decode(bytes.subarray(0, MAX_ACCEPT_BYTES));
}

function acceptedTags(header: string | null): string[] {
  if (header === null) return [];
  const entries = boundedHeader(header).split(',').slice(0, MAX_ACCEPT_ENTRIES);
  const ranked: { readonly tag: string; readonly quality: number; readonly order: number }[] = [];
  entries.forEach((entry, order) => {
    const [rawTag = '', ...params] = entry.split(';');
    const tag = rawTag.trim();
    if (tag === '' || tag === '*') return;
    let quality = 1;
    // RFC 9110 §12.5.4 allows other parameters; only `q` ranks, and a
    // malformed `q` discards the entry.
    for (const param of params) {
      const trimmed = param.trim();
      if (!/^q=/iu.test(trimmed)) continue;
      const parsed = QUALITY.exec(trimmed.toLowerCase());
      if (parsed === null) return;
      quality = Number(parsed[1]);
    }
    if (quality > 0) ranked.push({ tag, quality, order });
  });
  ranked.sort((a, b) => b.quality - a.quality || a.order - b.order);
  return ranked.map((entry) => entry.tag);
}

function pageLocale(tag: string): PageLocale {
  return { tag, dir: directionOf(tag) };
}

// An unsupported `en` is replaced by the first supported tag, so the result is
// always one the caller can render; an empty list has nothing to offer but `en`.
function fallback(supported: ReadonlyMap<string, string>): string {
  return supported.get(FALLBACK) ?? supported.values().next().value ?? FALLBACK;
}

export function negotiateLocale(input: NegotiationInput): PageLocale {
  const supported = new Map<string, string>();
  for (const tag of input.supported) {
    if (isValidLocale(tag)) supported.set(fold(tag), tag);
  }

  const candidates = [
    ...input.uiLocales,
    input.authenticated ? input.subjectLocale : null,
    input.tenantDefault,
    ...acceptedTags(input.acceptLanguage),
  ];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const match = lookup(candidate, supported);
    if (match !== null) return pageLocale(match);
  }
  return pageLocale(fallback(supported));
}
