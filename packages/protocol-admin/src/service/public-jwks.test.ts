import { describe, expect, it } from 'vitest';
import { publicJwks } from '#/service/public-jwks';

describe('publicJwks', () => {
  it('drops every private member and names the keys that carried one', () => {
    const key = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };
    expect(publicJwks({ keys: [key, { ...key, d: 'secret' }] })).toEqual({
      value: { keys: [key, key] },
      strippedKeys: [1],
    });
  });

  it('passes anything that is not a key set through unchanged', () => {
    expect(publicJwks(null)).toEqual({ value: null, strippedKeys: [] });
  });
});
