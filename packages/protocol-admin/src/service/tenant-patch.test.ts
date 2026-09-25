import { describe, expect, it } from 'vitest';
import { AMENDABLE_TENANT_FIELDS, TENANT_FIELDS, refusalFor } from '#/service/tenant-patch';

describe('the tenant amendment allowlist', () => {
  it('admits display_name and enabled, and nothing else', () => {
    expect([...AMENDABLE_TENANT_FIELDS].sort()).toEqual(['display_name', 'enabled']);
  });

  it('refuses identity, the name and history, each with a reason', () => {
    for (const field of ['id', 'name', 'created_at']) {
      expect(refusalFor(field), field).toEqual(expect.any(String));
    }
  });

  it("gives name's refusal the reason a caller needs, not a bare no", () => {
    expect(refusalFor('name')).toContain('issuer URL');
  });

  it('accounts for every field of the wire shape', () => {
    for (const field of TENANT_FIELDS) {
      const known = AMENDABLE_TENANT_FIELDS.includes(field) || refusalFor(field) !== null;
      expect(known, field).toBe(true);
    }
  });
});
