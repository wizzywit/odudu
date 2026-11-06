import { describe, expect, it } from 'vitest';
import { cleanData, cleanText, LONG_TEXT_CAP, TEXT_CAP, type CleanStats } from '#/service/sanitize';

function stats(): CleanStats {
  return { truncated: false };
}

describe('cleanText', () => {
  it('keeps ordinary text, newlines and tabs', () => {
    expect(cleanText('Ada Lovelace\nline\ttab', 100)).toBe('Ada Lovelace\nline\ttab');
  });

  it('removes control characters a terminal or a parser would act on', () => {
    expect(cleanText('a\u0000b\u001bc[31m\u0085d\u007fe', 100)).toBe('abc[31mde');
  });

  it('removes bidirectional overrides, embeddings and isolates, which reorder text on screen', () => {
    expect(cleanText('user‮gnp.exe⁦x⁩‪y', 100)).toBe('usergnp.exexy');
  });

  it('keeps the directional marks Persian and Arabic text carries', () => {
    for (const mark of ['‏', '‎', '؜']) {
      expect(cleanText(`علی${mark}2`, 100)).toBe(`علی${mark}2`);
    }
  });

  it('round-trips Persian, Arabic and Indic text with their joiners', () => {
    const samples = [
      'می‌خواهم',
      'علی‏ 2',
      'مرحبا؜ بالعالم',
      'क्‍ष',
      '\u{1F468}‍\u{1F469}‍\u{1F467}',
    ];
    for (const sample of samples) expect(cleanText(sample, 100)).toBe(sample);
  });

  it('removes characters that hide text from a reader', () => {
    const hidden: [string, string][] = [
      ['tag', '\u{E0041}\u{E0042}\u{E007F}'],
      ['word joiner', '⁠'],
      ['byte order mark', '﻿'],
      ['soft hyphen', '­'],
      ['zero width space', '​'],
    ];
    for (const [name, char] of hidden) {
      expect(cleanText(`a${char}b`, 100), name).toBe('ab');
    }
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
    const out = cleanData(
      { a: ['x\u0000y', { b: 'z'.repeat(TEXT_CAP + 10) }], n: 3, f: false, z: null },
      stats(),
    );
    expect(out).toEqual({
      a: ['xy', { b: `${'z'.repeat(TEXT_CAP - 1)}…` }],
      n: 3,
      f: false,
      z: null,
    });
  });

  it('cleans and caps keys as it does values', () => {
    const out = cleanData({ ['k\u0000‮y']: 1, ['q'.repeat(5_000)]: 2 }, stats());
    const keys = Object.keys(out as Record<string, unknown>);
    expect(keys).toContain('ky');
    expect(keys.every((key) => key.length <= TEXT_CAP)).toBe(true);
  });

  it('says when a string was cut, and only then', () => {
    const cut = stats();
    cleanData({ a: 'x'.repeat(TEXT_CAP + 1) }, cut);
    expect(cut.truncated).toBe(true);
    const whole = stats();
    cleanData({ a: 'x'.repeat(TEXT_CAP), b: 'y\u0000' }, whole);
    expect(whole.truncated).toBe(false);
  });

  it('refuses a value nested deeper than a response can be', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 100; i += 1) deep = { deep };
    expect(() => cleanData(deep, stats())).toThrow(/too deep/u);
  });

  it('drops a member that carries a secret, wherever an open record puts it', () => {
    const out = cleanData(
      {
        client_secret: 's3',
        nested: [{ Password: 'p', secret_hash: 'h', private_jwk_encrypted: 'e', ok: 1 }],
        jwks: {
          keys: [
            { kty: 'RSA', n: 'n', e: 'AQAB', d: 'D', p: 'P', q: 'Q', dp: '1', dq: '2', qi: '3' },
          ],
        },
        oct: { kty: 'oct', k: 'K' },
        d: 'a member named d without a kty is not a key',
      },
      stats(),
    );
    expect(out).toEqual({
      nested: [{ ok: 1 }],
      jwks: { keys: [{ kty: 'RSA', n: 'n', e: 'AQAB' }] },
      oct: { kty: 'oct' },
      d: 'a member named d without a kty is not a key',
    });
  });
});

describe('cleanData with a long-text allowance', () => {
  const KIB = 1024;
  const options = { longText: ['stylesheet', 'templates'] };

  it('keeps a stylesheet of 100 KiB whole and cuts one of 200 KiB, saying so', () => {
    const whole = stats();
    const out = cleanData({ stylesheet: 'a'.repeat(100 * KIB) }, whole, options) as {
      stylesheet: string;
    };
    expect(out.stylesheet).toHaveLength(100 * KIB);
    expect(whole.truncated).toBe(false);

    const cut = stats();
    const big = cleanData({ stylesheet: 'a'.repeat(200 * KIB) }, cut, options) as {
      stylesheet: string;
    };
    expect(big.stylesheet).toHaveLength(LONG_TEXT_CAP);
    expect(big.stylesheet.endsWith('…')).toBe(true);
    expect(cut.truncated).toBe(true);
  });

  it('reaches a string at any depth under a named member, which a key-only match would miss', () => {
    const body = { draft: { templates: { 'sign-in': 'b'.repeat(100 * KIB) } } };
    const out = cleanData(body, stats(), options) as typeof body;
    expect(out.draft.templates['sign-in']).toHaveLength(100 * KIB);

    const cut = stats();
    const big = cleanData(
      { published: { body: { templates: { consent: { nested: 'b'.repeat(200 * KIB) } } } } },
      cut,
      options,
    );
    expect(JSON.stringify(big).length).toBeLessThan(LONG_TEXT_CAP + 200);
    expect(cut.truncated).toBe(true);
  });

  it('cuts every other field at the ordinary cap, beside a long one', () => {
    const out = cleanData(
      {
        stylesheet: 'a'.repeat(5_000),
        name: 'n'.repeat(5_000),
        other: { note: 'x'.repeat(5_000) },
      },
      stats(),
      options,
    ) as { stylesheet: string; name: string; other: { note: string } };
    expect(out.stylesheet).toHaveLength(5_000);
    expect(out.name).toHaveLength(TEXT_CAP);
    expect(out.other.note).toHaveLength(TEXT_CAP);
  });

  it('strips the same characters from a long text as from any other', () => {
    const text = 'a\u0000b‮c​d\u{E0041}e';
    const out = cleanData({ stylesheet: text, name: text }, stats(), options) as {
      stylesheet: string;
      name: string;
    };
    expect(out.stylesheet).toBe('abcde');
    expect(out.stylesheet).toBe(out.name);
  });

  it('cuts a member named stylesheet at the ordinary cap where no allowance is declared', () => {
    const cut = stats();
    const out = cleanData({ stylesheet: 'a'.repeat(100 * KIB) }, cut) as { stylesheet: string };
    expect(out.stylesheet).toHaveLength(TEXT_CAP);
    expect(cut.truncated).toBe(true);
    const empty = cleanData({ stylesheet: 'a'.repeat(5_000) }, stats(), {}) as {
      stylesheet: string;
    };
    expect(empty.stylesheet).toHaveLength(TEXT_CAP);
  });

  it('still drops a secret member inside a long-text member', () => {
    const out = cleanData({ templates: { password: 'p', ok: 'fine' } }, stats(), options);
    expect(out).toEqual({ templates: { ok: 'fine' } });
  });
});
