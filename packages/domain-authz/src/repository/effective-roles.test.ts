import { describe, expect, it } from 'vitest';
import { effectiveRoleRowSchema } from '#/repository/effective-roles';

// The columns effectiveRoles selects are all NOT NULL (role_id, name) or
// declared nullable (client_key) in the schema migration, so the live query
// can never actually produce a row this schema rejects today — provoking a
// rejection through Postgres would require breaking a column's own NOT NULL
// constraint. This tests the schema directly instead, to prove the parse
// step itself fails loudly on a shape it doesn't recognise, which is what
// protects effectiveRoles if a future migration renames or retypes a column.
describe('effectiveRoleRowSchema', () => {
  it('accepts a well-formed row', () => {
    expect(() =>
      effectiveRoleRowSchema.parse({ role_id: 'role-1', name: 'admin', client_key: null }),
    ).not.toThrow();
  });

  it('rejects a row missing the name column', () => {
    expect(() => effectiveRoleRowSchema.parse({ role_id: 'role-1', client_key: null })).toThrow();
  });

  it('rejects a row whose role_id is not a string', () => {
    expect(() =>
      effectiveRoleRowSchema.parse({ role_id: 42, name: 'admin', client_key: null }),
    ).toThrow();
  });
});
