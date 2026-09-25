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

  // Pins the set of names, not their meaning: a route that introduces a new
  // parameter forces a decision here about whether it is a row id. A route
  // that reused `:id` for something that is not one would still pass —
  // nothing in a pattern distinguishes that, so it stays a review matter.
  it('names every parameter in ADMIN_ROUTES, so a new one forces a decision', () => {
    const names = new Set(
      ADMIN_ROUTES.flatMap((route) => [...route.pattern.matchAll(/:(\w+)/gu)].map((m) => m[1])),
    );

    expect([...names].sort()).toEqual(['clientId', 'credentialId', 'id', 'sid', 'tenant']);
  });
});
