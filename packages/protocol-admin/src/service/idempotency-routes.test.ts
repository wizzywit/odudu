import { documentedJsonSchema } from '@odudu/contracts/admin/docs';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { idempotentMethod } from '#/service/idempotency';

const SECRET_FIELDS = new Set(['password', 'secret', 'client_secret', 'client_secrets', 'token']);

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
    expect(posts.every((route) => route.method === 'POST')).toBe(true);
    expect(
      ADMIN_ROUTES.filter((route) => !idempotentMethod(route.method)).every(
        (route) => route.method !== 'POST',
      ),
    ).toBe(true);
  });

  it('refuse the key exactly where the response carries a secret shown once', () => {
    const carrying = posts
      .filter((route) =>
        [...propertyNames(documentedJsonSchema(route.responseSchema), new Set<string>())].some(
          (name) => SECRET_FIELDS.has(name),
        ),
      )
      .map((route) => route.pattern)
      .sort();
    const flagged = posts
      .filter((route) => route.oneTimeSecret === true)
      .map((route) => route.pattern)
      .sort();
    expect(flagged).toEqual(carrying);
    expect(flagged).toHaveLength(5);
  });

  it('never flags a route that is not a POST', () => {
    expect(
      ADMIN_ROUTES.filter((route) => route.oneTimeSecret === true && route.method !== 'POST'),
    ).toEqual([]);
  });
});
