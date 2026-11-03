import { describe, expect, it } from 'vitest';
import { readFilters } from '#/features/audit/services/auditAddress';

function read(search: string) {
  return readFilters(new URLSearchParams(search));
}

describe('the instants the address may hold', () => {
  it('ignores an instant the trail cannot hold, as the API would refuse it', () => {
    for (const value of [
      '0000-01-01T00:00:00Z',
      '0001-01-01T00:00:00%2B14:00',
      '1969-12-31T23:00:00Z',
    ]) {
      const { filters, ignored } = read(`from=${value}&action=ok`);
      expect(filters, value).toEqual({ action: 'ok' });
      expect(ignored, value).toHaveLength(1);
    }
    expect(read('to=9999-12-31T23:59:59-14:00').filters).toEqual({});
    expect(read('from=1970-01-01T00:00:00Z').filters).toEqual({ from: '1970-01-01T00:00:00Z' });
  });

  it('ignores a range before the trail begins, both ends of it, though a form would call it backwards', () => {
    const { filters, ignored } = read(
      'from=1969-12-31T23:00:00Z&to=1969-12-30T00:00:00Z&action=ok',
    );
    expect(filters).toEqual({ action: 'ok' });
    expect(ignored).toHaveLength(2);
  });
});
