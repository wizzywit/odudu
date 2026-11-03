import { describe, expect, it } from 'vitest';
import { AUTO } from '#/features/clients/services/choices';
import { idTokenAlgOptions } from '#/features/clients/services/idTokenPolicy';

describe('idTokenAlgOptions', () => {
  it('offers the tenant key first and then each algorithm a key can be made for', () => {
    expect(idTokenAlgOptions().map((each) => each.id)).toEqual([AUTO, 'RS256', 'ES256']);
  });
});
