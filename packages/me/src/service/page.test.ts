import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMIT, MAX_LIMIT } from '@odudu/contracts/me';
import { pageLimit, splitPage } from '#/service/page';

describe('pageLimit', () => {
  it('defaults when none is asked', () => {
    expect(pageLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it('keeps a limit within the bound', () => {
    expect(pageLimit(7)).toBe(7);
  });

  it('brings a limit past the bound down to it', () => {
    expect(pageLimit(MAX_LIMIT + 500)).toBe(MAX_LIMIT);
  });
});

describe('splitPage', () => {
  it('says there is more when a row beyond the limit came back', () => {
    expect(splitPage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
  });

  it('says there is no more when the rows fit', () => {
    expect(splitPage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
  });
});
