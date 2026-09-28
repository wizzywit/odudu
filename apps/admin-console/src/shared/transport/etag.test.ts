import { describe, expect, it } from 'vitest';
import { readEtag } from '#/shared/transport/etag.ts';

describe('readEtag', () => {
  it('keeps the entity-tag exactly as served, quotes included, for If-Match', () => {
    const headers = new Headers({ etag: '"219b14ef842053287d0395ac35365010"' });

    expect(readEtag(headers)).toBe('"219b14ef842053287d0395ac35365010"');
  });

  it('is null when the response carries none', () => {
    expect(readEtag(new Headers())).toBeNull();
  });
});
