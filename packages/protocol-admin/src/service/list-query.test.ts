import { describe, expect, it } from 'vitest';
import { prefixUpperBound } from '#/service/list-query';

describe('prefixUpperBound', () => {
  it('increments the last code point', () => {
    expect(prefixUpperBound('ada')).toBe('adb');
    expect(prefixUpperBound('az')).toBe('a{');
  });

  it('treats LIKE metacharacters as ordinary characters', () => {
    expect(prefixUpperBound('a_b')).toBe('a_c');
    expect(prefixUpperBound('%')).toBe('&');
    expect(prefixUpperBound('a\\')).toBe('a]');
  });

  it('increments a code point outside the BMP as one character, not a surrogate', () => {
    expect(prefixUpperBound('a\u{1F600}')).toBe('a\u{1F601}');
  });

  it('steps over the surrogate range, which is not text PostgreSQL can hold', () => {
    expect(prefixUpperBound('a\u{D7FF}')).toBe('a\u{E000}');
  });

  it('drops a trailing U+10FFFF before incrementing', () => {
    expect(prefixUpperBound('ab\u{10FFFF}')).toBe('ac');
    expect(prefixUpperBound('ab\u{10FFFF}\u{10FFFF}')).toBe('ac');
  });

  it('answers null when nothing remains to increment', () => {
    expect(prefixUpperBound('\u{10FFFF}')).toBeNull();
    expect(prefixUpperBound('')).toBeNull();
  });
});
