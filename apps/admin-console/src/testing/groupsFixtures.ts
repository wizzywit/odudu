import { json, type Answer, type Sent } from '#/testing/fakeTransport.ts';
import { GRACE, whoami } from '#/testing/renderConsole.tsx';
import { ADMIN_ROLES, EVERY_TENANT_CAPABILITY, role } from '#/testing/subjectsFixtures.ts';

export const A = '/console/api/admin/tenants/acme';
export const G = `${A}/groups`;

export function group(
  id: string,
  path: string,
  parent: string | null = null,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: path.split('/').at(-1) ?? path,
    description: null,
    parent_id: parent,
    default_for_new_subjects: false,
    path,
    created_at: '2026-09-28T08:41:53.858Z',
    ...extra,
  };
}

export const ENG = group('g-eng', '/eng', null, { description: 'Builds the product' });
export const PLATFORM = group('g-plat', '/eng/platform', 'g-eng');
export const FINANCE = group('g-fin', '/finance');
export const GROUPS = [ENG, PLATFORM, FINANCE];

export const AUDITOR = { ...role('r-aud', 'auditor'), description: 'Reads the books' };
export const PORTAL_READER = role('r-portal', 'reader', 'portal');

// The built-in admin client's role of this name.
export function adminRole(name: string) {
  const found = ADMIN_ROLES.find((each) => each.name === name);
  if (found === undefined) throw new Error(`no admin role ${name}`);
  return found;
}

function listed(request: Sent) {
  const parent = request.search.get('parent');
  const name = request.search.get('name');
  return GROUPS.filter(
    (each) =>
      (parent === null ||
        (parent === 'root' ? each.parent_id === null : each.parent_id === parent)) &&
      (name === null || each.name.startsWith(name.toLowerCase())),
  );
}

// grace of acme, holding the capabilities given, among /eng, /eng/platform
// and /finance.
export function groupRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return {
    'GET /console/api/session': json(GRACE),
    [`GET ${A}/whoami`]: whoami(capabilities),
    [`GET ${G}`]: (request) => json({ items: listed(request) })(request),
    [`GET ${G}/count`]: (request) =>
      json({ count: listed(request).length, capped: false })(request),
    ...Object.fromEntries(
      GROUPS.flatMap((each) => [
        [`GET ${G}/${each.id}`, json(each, 200, { etag: `"${each.id}-1"` })],
        [`GET ${G}/${each.id}/roles`, json({ items: [] }, 200, { etag: `"${each.id}-r1"` })],
      ]),
    ),
    [`GET ${A}/roles`]: json({ items: [AUDITOR, PORTAL_READER, ...ADMIN_ROLES] }),
    [`GET ${A}/audit`]: json({ items: [] }),
    [`GET ${A}/subjects`]: json({ items: [] }),
    [`GET ${A}/subjects/count`]: json({ count: 0, capped: false }),
    ...extra,
  };
}
