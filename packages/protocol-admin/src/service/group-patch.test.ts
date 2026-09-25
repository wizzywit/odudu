import { describe, expect, it } from 'vitest';
import { AMENDABLE_GROUP_FIELDS, GROUP_FIELDS, refusalFor } from '#/service/group-patch';

describe('the group amendment allowlist', () => {
  it('admits only parent_id', () => {
    expect(AMENDABLE_GROUP_FIELDS).toEqual(['parent_id']);
  });

  it('refuses identity, structure and history, each with a reason', () => {
    for (const field of ['id', 'name', 'path', 'created_at']) {
      expect(refusalFor(field), field).toEqual(expect.any(String));
    }
  });

  it('gives parent_id no refusal', () => {
    expect(refusalFor('parent_id')).toBeNull();
  });

  it('gives a field this resource has never heard of no refusal either', () => {
    expect(refusalFor('secret_hash')).toBeNull();
  });

  it('accounts for every field of the group wire shape', () => {
    for (const field of GROUP_FIELDS) {
      const known = AMENDABLE_GROUP_FIELDS.includes(field) || refusalFor(field) !== null;
      expect(known, field).toBe(true);
    }
  });
});
