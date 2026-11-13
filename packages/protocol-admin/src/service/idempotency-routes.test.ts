import { documentedJsonSchema } from '@odudu/contracts/admin/docs';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { idempotentMethod } from '#/service/idempotency';

const SECRET_FIELDS = new Set(['password', 'secret', 'client_secret', 'client_secrets', 'token']);
const SUSPECT_FIELD = /setup|recovery|invite|url|link|code|key|otp|credential|private/iu;

// Every POST, classified. A new POST fails the first test until it is
// listed here, which is where somebody decides what a replay of it would do.
const CLASSIFIED: Record<string, 'idempotent' | 'secret' | 'not-atomic' | 'external-io'> = {
  '/admin/tenants/:tenant/subjects': 'idempotent',
  '/admin/tenants/:tenant/subjects/bulk': 'idempotent',
  '/admin/tenants/:tenant/subjects/:id/password': 'secret',
  '/admin/tenants/:tenant/subjects/:id/password-reset': 'idempotent',
  '/admin/tenants/:tenant/subjects/:id/verification': 'idempotent',
  '/admin/tenants/:tenant/subjects/:id/actions-email': 'idempotent',
  '/admin/tenants': 'not-atomic',
  '/admin/tenant-imports': 'secret',
  '/admin/tenants/:tenant/theme/publish': 'idempotent',
  '/admin/tenants/:tenant/theme/versions/:versionId/restore': 'idempotent',
  '/admin/tenants/:tenant/theme/assets': 'idempotent',
  '/admin/tenants/:tenant/clients': 'secret',
  '/admin/tenants/:tenant/clients/:id/secret': 'secret',
  '/admin/tenants/:tenant/clients/:id/theme/publish': 'idempotent',
  '/admin/tenants/:tenant/clients/:id/theme/versions/:versionId/restore': 'idempotent',
  '/admin/tenants/:tenant/registration-tokens': 'secret',
  '/admin/tenants/:tenant/domains': 'idempotent',
  '/admin/tenants/:tenant/domains/:id/verify': 'external-io',
  '/admin/tenants/:tenant/domains/:id/activate': 'idempotent',
  '/admin/tenants/:tenant/domains/:id/deactivate': 'idempotent',
  '/admin/tenants/:tenant/roles': 'idempotent',
  '/admin/tenants/:tenant/roles/:id/composites': 'idempotent',
  '/admin/tenants/:tenant/groups': 'idempotent',
  '/admin/tenants/:tenant/flows': 'idempotent',
  '/admin/tenants/:tenant/scopes': 'idempotent',
  '/admin/tenants/:tenant/scopes/restore-builtins': 'idempotent',
  '/admin/tenants/:tenant/keys': 'idempotent',
  '/admin/tenants/:tenant/keys/:id/promote': 'idempotent',
  '/admin/tenants/:tenant/keys/:id/retire': 'idempotent',
  '/admin/tenants/:tenant/smtp/test': 'external-io',
};

// Response members that look like a secret by name and are not, each
// reviewed against its schema. A member is named here with its route.
const REVIEWED_NOT_SECRET: Record<string, string> = {
  '/admin/tenants/:tenant/theme/publish code': 'the code of a failed theme check, not a credential',
  '/admin/tenants/:tenant/clients/:id/theme/publish code':
    'the code of a failed theme check, not a credential',
  '/admin/tenants/:tenant/roles client_key':
    'the client_id a role belongs to, public in every read',
};

function propertyNames(node: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) propertyNames(child, found);
    return found;
  }
  if (typeof node !== 'object' || node === null) return found;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const name of Object.keys(value)) found.add(name);
    }
    propertyNames(value, found);
  }
  return found;
}

const posts = ADMIN_ROUTES.filter((route) => idempotentMethod(route.method));

describe('the routes that take an Idempotency-Key', () => {
  it('are every POST, derived from the route table’s method', () => {
    expect(posts.length).toBeGreaterThan(20);
    expect(
      ADMIN_ROUTES.filter((route) => !idempotentMethod(route.method)).every(
        (route) => route.method !== 'POST',
      ),
    ).toBe(true);
  });

  it('classify every POST, so a new one cannot go unconsidered', () => {
    expect(posts.map((route) => route.pattern).sort()).toEqual(Object.keys(CLASSIFIED).sort());
  });

  it('refuse the key exactly where the table says they cannot keep it', () => {
    for (const route of posts) {
      const kind = CLASSIFIED[route.pattern];
      expect(route.noIdempotency, route.pattern).toBe(kind === 'idempotent' ? undefined : kind);
    }
  });

  it('refuse it wherever a response member is named like a secret', () => {
    const suspect: string[] = [];
    for (const route of posts) {
      const names = [
        ...propertyNames(documentedJsonSchema(route.responseSchema), new Set<string>()),
      ];
      const exact = names.some((name) => SECRET_FIELDS.has(name));
      if (exact) expect(route.noIdempotency, route.pattern).toBe('secret');
      for (const name of names) {
        if (!SUSPECT_FIELD.test(name) || SECRET_FIELDS.has(name)) continue;
        if (route.noIdempotency === 'secret') continue;
        if (REVIEWED_NOT_SECRET[`${route.pattern} ${name}`] === undefined) {
          suspect.push(`${route.pattern} ${name}`);
        }
      }
    }
    expect(suspect).toEqual([]);
  });

  it('never flags a route that is not a POST', () => {
    expect(
      ADMIN_ROUTES.filter((route) => route.noIdempotency !== undefined && route.method !== 'POST'),
    ).toEqual([]);
  });
});
