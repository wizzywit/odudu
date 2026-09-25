import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { paramsSchemaFor } from '#/service/path-params';

const UUID = '0199aa00-0000-7000-8000-000000000001';

describe('paramsSchemaFor', () => {
  it('narrows every id segment a pattern declares', () => {
    const schema = paramsSchemaFor('/admin/tenants/:tenant/subjects/:id/sessions/:sid');

    expect(Object.keys(schema?.shape ?? {})).toEqual(['id', 'sid']);
    expect(schema?.safeParse({ id: UUID, sid: UUID }).success).toBe(true);
    expect(schema?.safeParse({ id: UUID, sid: 'not-a-uuid' }).success).toBe(false);
  });

  // A tenant is addressed by name, so narrowing it to a uuid would refuse
  // every real request.
  it('leaves :tenant alone', () => {
    expect(paramsSchemaFor('/admin/tenants/:tenant/settings')).toBeUndefined();
  });

  it('attaches nothing to a pattern with no parameters', () => {
    expect(paramsSchemaFor('/admin/tenants')).toBeUndefined();
  });

  // The rule holds for the table as it stands, so a later route cannot
  // introduce a third kind of segment without this going red.
  it('classifies every parameter in ADMIN_ROUTES as a tenant name or a row id', () => {
    const names = new Set(
      ADMIN_ROUTES.flatMap((route) => [...route.pattern.matchAll(/:(\w+)/gu)].map((m) => m[1])),
    );

    expect([...names].sort()).toEqual(['clientId', 'credentialId', 'id', 'sid', 'tenant']);
  });
});
