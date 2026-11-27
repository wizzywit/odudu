import { describe, expect, it } from 'vitest';
import { cleanJson, cleanText } from '#/service/clean-text';

const FFFD = '�';

describe('cleanText', () => {
  it('replaces NUL and a lone surrogate, which jsonb and text columns refuse', () => {
    expect(cleanText('a\u0000b')).toBe(`a${FFFD}b`);
    expect(cleanText('a\uD800b')).toBe(`a${FFFD}b`);
    expect(cleanText('a\uDC00b')).toBe(`a${FFFD}b`);
    expect(cleanText('end\uD83D')).toBe(`end${FFFD}`);
  });

  it('keeps a pair of surrogates, which is one character, and ordinary text', () => {
    expect(cleanText('smile \u{1F600} ok')).toBe('smile \u{1F600} ok');
    expect(cleanText('plain é text')).toBe('plain é text');
  });
});

describe('cleanJson', () => {
  it('cleans every string at every depth and every key', () => {
    const out = cleanJson({
      'k\u0000ey': ['a\u0000', { deep: 'b\uD800', n: 1, ok: true, none: null }],
    });
    expect(out).toEqual({
      [`k${FFFD}ey`]: [`a${FFFD}`, { deep: `b${FFFD}`, n: 1, ok: true, none: null }],
    });
    expect(JSON.stringify(out)).not.toMatch(/\\u0000|\\ud800/iu);
  });

  it('does not walk a document nested beyond reason', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 200; i += 1) deep = { next: deep };
    expect(() => cleanJson(deep as never)).not.toThrow();
  });
});
