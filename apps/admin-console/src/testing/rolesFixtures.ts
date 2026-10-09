import { json, type Answer, type Sent } from '#/testing/fakeTransport.ts';
import { GRACE, whoami } from '#/testing/renderConsole.tsx';
import { ADMIN_ROLES, EVERY_TENANT_CAPABILITY, role } from '#/testing/subjectsFixtures.ts';

export const A = '/console/api/admin/tenants/acme';
export const R = `${A}/roles`;

export const AUDITOR = { ...role('r-aud', 'auditor'), description: 'Reads the books' };
export const READER = role('r-read', 'reader');
export const PORTAL_READER = role('r-portal', 'reader', 'portal');
export const ROLES = [AUDITOR, READER, PORTAL_READER, ...ADMIN_ROLES];

function listed(request: Sent) {
  const client = request.search.get('client');
  const name = request.search.get('name');
  return ROLES.filter(
    (each) =>
      (client === null ||
        (client === 'tenant' ? each.client_id === null : each.client_id === client)) &&
      (name === null || each.name.startsWith(name.toLowerCase())),
  );
}

// grace of acme, holding the capabilities given, among the roles above.
export function roleRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return {
    'GET /console/api/session': json(GRACE),
    [`GET ${A}/whoami`]: whoami(capabilities),
    [`GET ${R}`]: (request) => json({ items: listed(request) })(request),
    [`GET ${R}/count`]: (request) =>
      json({ count: listed(request).length, capped: false })(request),
    ...Object.fromEntries(
      ROLES.flatMap((each) => [
        [`GET ${R}/${each.id}`, json(each, 200, { etag: `"${each.id}-1"` })],
        [`GET ${R}/${each.id}/composites`, json({ items: [] }, 200, { etag: `"${each.id}-c1"` })],
      ]),
    ),
    [`GET ${A}/audit`]: json({ items: [] }),
    [`GET ${A}/subjects`]: json({ items: [] }),
    [`GET ${A}/subjects/count`]: json({ count: 0, capped: false }),
    [`GET ${A}/subjects/s1/admin-capabilities`]: json({ items: [], complete: true }),
    [`GET ${A}/subjects/s1/groups`]: json({ items: [] }, 200, { etag: '"m0"' }),
    ...extra,
  };
}
