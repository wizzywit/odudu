import { brandingProblems } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { MAX_ALT_LENGTH, parseThemeBody } from '#/service/body';

const ID = '3f2c1a9e-8b7d-4c6e-9a5f-0d1e2f3a4b5c';

const savable = (alt: string): boolean =>
  parseThemeBody({ assets: { logo: { assetId: ID, alt } } }).ok;

// Only the alt problems: the rest of the branding is valid.
const sendable = (alt: string): boolean =>
  brandingProblems({
    origin: 'https://idp.example',
    templates: {},
    tokensCss: '',
    stylesheetUrl: null,
    faviconUrl: null,
    logo: { url: '/t/a/l.png', darkUrl: null, alt },
    assetUrls: [],
  }).length === 0;

// The theme body is validated when saved and the branding when a page is
// sent; a value the first accepts and the second refuses leaves every page on
// the default theme. Other bounds the kernel checks (URLs, origin) are of
// values the server builds, which no body carries.
describe('a logo alt the schema accepts is one the pages can send', () => {
  const alts: [string, string][] = [
    ['200 ASCII', 'a'.repeat(200)],
    ['201 ASCII', 'a'.repeat(201)],
    ['100 emoji', '😀'.repeat(100)],
    ['101 emoji', '😀'.repeat(101)],
    ['200 emoji', '😀'.repeat(200)],
    ['201 emoji', '😀'.repeat(201)],
    ['a lone surrogate', '\ud83d'],
    ['200 lone surrogates', '\ud83d'.repeat(200)],
    ['combining marks', 'é'.repeat(100)],
    ['many combining marks', 'é'.repeat(101)],
    ['blank', '   '],
    ['10 MB', 'x'.repeat(10_000_000)],
  ];
  it.each(alts)('%s', (_name, alt) => {
    expect(sendable(alt)).toBe(savable(alt));
  });

  it('shares the bound', () => {
    expect(MAX_ALT_LENGTH).toBe(200);
    expect(savable('a'.repeat(MAX_ALT_LENGTH))).toBe(true);
    expect(savable('a'.repeat(MAX_ALT_LENGTH + 1))).toBe(false);
  });
});
