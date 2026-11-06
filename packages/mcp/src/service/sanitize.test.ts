import { describe, expect, it } from 'vitest';
import { cleanData, cleanText, TEXT_CAP } from '#/service/sanitize';

describe('cleanText', () => {
  it('keeps ordinary text, newlines and tabs', () => {
    expect(cleanText('Ada Lovelace\nline\ttab', 100)).toBe('Ada Lovelace\nline\ttab');
  });

  it('removes control characters a terminal or a parser would act on', () => {
    expect(cleanText('a\u0000b\u001bc[31m\u0085d\u007fe', 100)).toBe('abc[31mde');
  });

  it('removes bidirectional overrides and isolates, which reorder text on screen', () => {
    expect(cleanText('user‮gnp.exe⁦x⁩‏y', 100)).toBe('usergnp.exexy');
  });

  it('keeps zero-width joiners, which emoji sequences need', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(cleanText(family, 100)).toBe(family);
  });

  it('cuts to the cap, marker included, without splitting a surrogate pair', () => {
    const cut = cleanText('\u{1F600}'.repeat(50), 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/[\uD800-\uDBFF]…$/u);
  });

  it('bounds a huge string by its cap, not by its length', () => {
    expect(cleanText('x'.repeat(5_000_000), TEXT_CAP).length).toBe(TEXT_CAP);
  });
});

describe('cleanData', () => {
  it('cleans every string in a nested value and leaves the rest alone', () => {
    const out = cleanData({
      a: ['x\u0000y', { b: 'z'.repeat(TEXT_CAP + 10) }],
      n: 3,
      f: false,
      z: null,
    });
    expect(out).toEqual({
      a: ['xy', { b: expect.stringMatching(/…$/u) }],
      n: 3,
      f: false,
      z: null,
    });
  });

  it('refuses a value nested deeper than a response can be', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 100; i += 1) deep = { deep };
    expect(() => cleanData(deep)).toThrow(/too deep/u);
  });
});
