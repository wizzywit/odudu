import { json, type Answer, type Sent } from '#/testing/fakeTransport';
import { matchesName } from '#/testing/listFilters';
import { CLIENTS } from '#/testing/clientsFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { graceRoutes } from '#/testing/renderConsole';
import { ROLES } from '#/testing/rolesFixtures';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';
import { settingsAnswer, ST } from '#/testing/settingsFixtures';
export const SC = `${ACME_ADMIN}/scopes`;

export interface ScopeAnswer {
  id: string;
  name: string;
  description: string | null;
  include_in_id_token: boolean;
  include_in_access_token: boolean;
  default_client_assignment: 'default' | 'optional' | null;
  consent_text: string | null;
  description_i18n: Record<string, string>;
  consent_text_i18n: Record<string, string>;
  display_order: number;
  created_at: string;
}

export function scope(id: string, name: string, extra: Partial<ScopeAnswer> = {}): ScopeAnswer {
  return {
    id,
    name,
    description: null,
    include_in_id_token: false,
    include_in_access_token: true,
    default_client_assignment: null,
    consent_text: null,
    description_i18n: {},
    consent_text_i18n: {},
    display_order: 0,
    created_at: '2026-09-28T08:41:53.858Z',
    ...extra,
  };
}

export const OPENID = scope('s-openid', 'openid', { include_in_id_token: true });
export const BILLING_SCOPE = scope('s-bill', 'billing', { description: 'Invoices' });
export const REPORTS = scope('s-rep', 'reports:read');
export const SCOPES = [OPENID, BILLING_SCOPE, REPORTS];

// The roles a scope maps, as its own read answers them: with what each reaches, no description.
export const MAPPED = {
  id: 'r-aud',
  name: 'auditor',
  client_id: null,
  client_key: null,
  admin_reach: [],
};

function listed(request: Sent) {
  return SCOPES.filter((each) => matchesName(request, each));
}

// The clients that carry a scope, as the scope's own list answers them.
export function carrier(
  id: string,
  clientId: string,
  name: string,
  assignment: 'default' | 'optional' = 'default',
) {
  return { id, client_id: clientId, name, assignment };
}

export const BILLING_CARRIES = carrier('c-bill', 'billing', 'Billing');

export function impact(
  clients: number,
  roles: number,
  extra: { builtin?: boolean; clientsCapped?: boolean } = {},
) {
  return {
    builtin: extra.builtin ?? false,
    client_assignments: { count: clients, capped: extra.clientsCapped ?? false },
    role_mappings: { count: roles, capped: false },
  };
}

// A built-in scope outside the list, so the tests that count rows are not disturbed.
export const PROFILE_SCOPE = scope('s-prof', 'profile', { include_in_access_token: false });

// The built-ins a tenant is given, in the order the server lists them.
export const BUILTIN_NAMES = [
  'openid',
  'profile',
  'email',
  'address',
  'phone',
  'roles',
  'groups',
  'offline_access',
] as const;

export function builtinsPresent(missing: readonly string[] = []) {
  return { items: BUILTIN_NAMES.map((name) => ({ name, present: !missing.includes(name) })) };
}

// The record routes of PROFILE_SCOPE, which carries three clients and maps two roles.
export function profileRoutes(): Record<string, Answer> {
  return {
    [`GET ${SC}/s-prof`]: json(PROFILE_SCOPE, 200, { etag: '"s-prof-1"' }),
    [`GET ${SC}/s-prof/roles`]: json({ items: [] }, 200, { etag: '"s-prof-r1"' }),
    [`GET ${SC}/s-prof/mappers`]: json(
      { available: ['email', 'groups'], bound: [], declared: ['email'] },
      200,
      { etag: '"s-prof-m1"' },
    ),
    [`GET ${SC}/s-prof/clients`]: json({ items: [] }),
    [`GET ${SC}/s-prof/impact`]: json(impact(3, 2, { builtin: true })),
  };
}

// grace of acme, holding the capabilities given, among three scopes: billing
// maps the auditor role, binds no mapper, and is carried by the billing client.
export function scopeRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    {
      [`GET ${SC}`]: (request) => json({ items: listed(request) })(request),
      [`GET ${SC}/count`]: (request) =>
        json({ count: listed(request).length, capped: false })(request),
      ...Object.fromEntries(
        SCOPES.flatMap((each) => [
          [`GET ${SC}/${each.id}`, json(each, 200, { etag: `"${each.id}-1"` })],
          [`GET ${SC}/${each.id}/roles`, json({ items: [] }, 200, { etag: `"${each.id}-r1"` })],
          [
            `GET ${SC}/${each.id}/mappers`,
            json({ available: ['email', 'groups'], bound: [], declared: ['email'] }, 200, {
              etag: `"${each.id}-m1"`,
            }),
          ],
          [`GET ${SC}/${each.id}/clients`, json({ items: [] })],
          [`GET ${SC}/${each.id}/impact`, json(impact(0, 0, { builtin: each.id === 's-openid' }))],
        ]),
      ),
      [`GET ${SC}/s-bill/impact`]: json(impact(1, 1)),
      [`GET ${SC}/builtins`]: json(builtinsPresent()),
      [`GET ${ST}`]: settingsAnswer({ supported_locales: ['en', 'fr', 'de'] }),
      [`GET ${SC}/s-bill/roles`]: json({ items: [MAPPED] }, 200, { etag: '"s-bill-r1"' }),
      [`GET ${SC}/s-bill/clients`]: json({ items: [BILLING_CARRIES] }),
      [`GET ${ACME_ADMIN}/roles`]: (request) =>
        json({ items: ROLES.filter((each) => matchesName(request, each)) })(request),
      [`GET ${ACME_ADMIN}/clients`]: (request) =>
        json({
          items: CLIENTS.filter(
            (each) =>
              request.search.get('name') === null ||
              each.name.toLowerCase().startsWith((request.search.get('name') ?? '').toLowerCase()),
          ),
        })(request),
      [`GET ${ACME_ADMIN}/audit`]: json({ items: [] }),
    },
    extra,
  );
}
