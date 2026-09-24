import { describe, expect, it } from 'vitest';
import { AMENDABLE_ROLE_FIELDS, refusalFor, ROLE_FIELDS } from '#/service/role-patch';

describe('the role amendment allowlist', () => {
  it('admits only description', () => {
    expect(AMENDABLE_ROLE_FIELDS).toEqual(['description']);
  });

  it('refuses identity, provenance and history, each with a reason', () => {
    for (const field of ['id', 'name', 'client_id', 'default_for_new_subjects', 'created_at']) {
      expect(refusalFor(field), field).toEqual(expect.any(String));
    }
  });

  it('gives description no refusal', () => {
    expect(refusalFor('description')).toBeNull();
  });

  it('gives a field this resource has never heard of no refusal either', () => {
    expect(refusalFor('secret_hash')).toBeNull();
  });

  it('accounts for every field of the role wire shape', () => {
    for (const field of ROLE_FIELDS) {
      const known = AMENDABLE_ROLE_FIELDS.includes(field) || refusalFor(field) !== null;
      expect(known, field).toBe(true);
    }
  });
});
