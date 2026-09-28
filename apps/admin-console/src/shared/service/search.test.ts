import { describe, expect, it } from 'vitest';
import { parseSearch, stringifySearch } from '#/shared/service/search.ts';

describe('the URL search the console writes', () => {
  it('reads a repeated parameter as a list, and a single one as a string', () => {
    expect(parseSearch('?after=a.b&after=c.d&tab=general')).toEqual({
      after: ['a.b', 'c.d'],
      tab: 'general',
    });
    expect(parseSearch('after=a.b')).toEqual({ after: 'a.b' });
    expect(parseSearch('')).toEqual({});
  });

  it('keeps every value a string rather than guessing at JSON', () => {
    expect(parseSearch('?q=123&enabled=true&name=%5B1%5D')).toEqual({
      q: '123',
      enabled: 'true',
      name: '[1]',
    });
  });

  it('writes a list as the parameter repeated, in order', () => {
    expect(stringifySearch({ tab: 'tokens', after: ['a.b', 'c.d'] })).toBe(
      '?tab=tokens&after=a.b&after=c.d',
    );
  });

  it('leaves out what is absent or empty, and writes nothing for no parameters', () => {
    expect(stringifySearch({ after: [], tab: undefined, q: null })).toBe('');
    expect(stringifySearch({ limit: 50, open: true })).toBe('?limit=50&open=true');
  });

  it('round-trips what it writes', () => {
    const search = { after: ['a.b', 'c.d'], q: 'grace hopper' };
    expect(parseSearch(stringifySearch(search))).toEqual(search);
  });
});
