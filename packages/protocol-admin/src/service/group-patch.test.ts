import { describe, expect, it } from 'vitest';
import { AMENDABLE_GROUP_FIELDS, GROUP_FIELDS, refusalFor } from '#/service/group-patch';

describe('the group amendment allowlist', () => {
  it('admits only description and parent_id', () => {
    expect(AMENDABLE_GROUP_FIELDS).toEqual(['description', 'parent_id']);
  });

  it('refuses identity, structure and history, each with a reason', () => {
    for (const field of ['id', 'name', 'path', 'created_at']) {
      expect(refusalFor(field), field).toEqual(expect.any(String));
    }
  });

  it('refuses the derived fields, which no write sets', () => {
    expect(GROUP_FIELDS).toEqual(
      expect.arrayContaining(['admin_reach', 'subtree_admin_reach', 'holds_default_group']),
    );
    for (const field of ['admin_reach', 'subtree_admin_reach', 'holds_default_group']) {
      expect(refusalFor(field), field).toMatch(/derived/u);
    }
  });

  it('gives parent_id no refusal', () => {
    expect(refusalFor('parent_id')).toBeNull();
  });

  it('never offers the stored search key, which the table has and the wire shape does not', () => {
    expect(GROUP_FIELDS).not.toContain('name_search');
    expect(AMENDABLE_GROUP_FIELDS).not.toContain('name_search');
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
  it('refuses a rename as permanent, pointing at no operation that could do it', () => {
    const reason = refusalFor('name');
    expect(reason).toContain('ADR 0039');
    expect(reason).toMatch(/is not offered/u);
    expect(reason).not.toMatch(/own operation/u);
  });
});
