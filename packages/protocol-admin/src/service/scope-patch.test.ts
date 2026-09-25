import { describe, expect, it } from 'vitest';
import { AMENDABLE_SCOPE_FIELDS, refusalFor, SCOPE_FIELDS } from '#/service/scope-patch';

describe('the client scope amendment allowlist', () => {
  it('admits description and both include flags', () => {
    expect(AMENDABLE_SCOPE_FIELDS).toEqual([
      'description',
      'include_in_id_token',
      'include_in_access_token',
    ]);
  });

  it('refuses identity and history, each with a reason', () => {
    for (const field of ['id', 'name', 'created_at']) {
      expect(refusalFor(field), field).toEqual(expect.any(String));
    }
  });

  it('gives an amendable field no refusal', () => {
    for (const field of AMENDABLE_SCOPE_FIELDS) {
      expect(refusalFor(field)).toBeNull();
    }
  });

  it('gives a field this resource has never heard of no refusal either', () => {
    expect(refusalFor('secret_hash')).toBeNull();
  });

  it('accounts for every field of the scope wire shape', () => {
    for (const field of SCOPE_FIELDS) {
      const known = AMENDABLE_SCOPE_FIELDS.includes(field) || refusalFor(field) !== null;
      expect(known, field).toBe(true);
    }
  });
});
