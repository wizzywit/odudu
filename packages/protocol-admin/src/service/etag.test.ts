import { describe, expect, it } from 'vitest';
import { etagOf, matches } from '#/service/etag';

describe('etagOf', () => {
  it('is stable for equal records and differs for different ones', () => {
    expect(etagOf({ a: 1, b: 2 })).toBe(etagOf({ b: 2, a: 1 }));
    expect(etagOf({ a: 1 })).not.toBe(etagOf({ a: 2 }));
  });
});

describe('matches', () => {
  it('treats an absent header as a caller who did not ask', () => {
    expect(matches(undefined, '"abc"')).toBe('absent');
  });
  it('matches an equal tag and refuses an unequal one', () => {
    expect(matches('"abc"', '"abc"')).toBe('match');
    expect(matches('"stale"', '"abc"')).toBe('mismatch');
  });
  it('refuses a wildcard rather than treating it as a match', () => {
    // `*` means "if the resource exists" in RFC 9110; honouring it here
    // would make an unconditional write look conditional.
    expect(matches('*', '"abc"')).toBe('mismatch');
  });
});
