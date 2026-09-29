import { describe, expect, it } from 'vitest';
import {
  callingCodeOf,
  countryOptions,
  englishCountryName,
  REGIONS,
  regionOfCountryName,
} from '#/shared/service/regions.ts';

describe('regions', () => {
  it('lists each ISO 3166 region once', () => {
    const codes = REGIONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[A-Z]{2}$/u.test(code))).toBe(true);
    expect(codes.length).toBeGreaterThan(240);
  });

  it('names every region, so none falls back to its bare code', () => {
    for (const { code } of REGIONS) expect(englishCountryName(code)).not.toBe(code);
  });

  it('stores the English name, per OIDC Core §5.1.1', () => {
    expect(englishCountryName('NG')).toBe('Nigeria');
    expect(englishCountryName('DE')).toBe('Germany');
  });

  it('stores the ISO 3166-1 short name pinned here, whatever the browser’s CLDR says', () => {
    expect(englishCountryName('TR')).toBe('Türkiye');
    expect(englishCountryName('CI')).toBe("Côte d'Ivoire");
    expect(englishCountryName('GB')).toBe('United Kingdom of Great Britain and Northern Ireland');
    expect(englishCountryName('HK')).toBe('Hong Kong');
    const names = REGIONS.map(({ code }) => englishCountryName(code));
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.length > 2)).toBe(true);
  });

  it('reads an older or the browser’s own spelling as the same country', () => {
    for (const name of ['Turkey', 'Czech Republic', 'Swaziland', 'Macedonia', "Cote d'Ivoire"]) {
      expect(regionOfCountryName(name), name).not.toBeNull();
    }
    const cldr = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const { code } of REGIONS) expect(regionOfCountryName(cldr.of(code) ?? '')).toBe(code);
  });

  it('shows the names in the reader’s language', () => {
    const german = countryOptions('de');
    expect(german.find((o) => o.id === 'DE')?.label).toBe('Deutschland');
    const labels = german.map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'de')));
  });

  it('finds the region a stored English name is, whatever its case', () => {
    expect(regionOfCountryName('nigeria')).toBe('NG');
    expect(regionOfCountryName('Atlantis')).toBeNull();
  });

  it('knows the calling code of a region', () => {
    expect(callingCodeOf('NG')).toBe('234');
    expect(callingCodeOf('US')).toBe('1');
    expect(callingCodeOf('AQ')).toBeNull();
  });
});
