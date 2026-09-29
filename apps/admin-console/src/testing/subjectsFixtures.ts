import { json, type Answer } from '#/testing/fakeTransport.ts';
import { GRACE, whoami } from '#/testing/renderConsole.tsx';

export const S = '/console/api/admin/tenants/acme/subjects';
export const SETTINGS = '/console/api/admin/tenants/acme/settings';
export const ADA_ID = '01a0e72d-7fc7-7950-a1e7-1d079588f8b4';
export const ADA_AT = `/console/acme/subjects/${ADA_ID}`;
export const EVERY_TENANT_CAPABILITY = [
  'view-users',
  'manage-users',
  'manage-tenant',
  'manage-clients',
  'manage-keys',
  'manage-sessions',
  'view-audit',
];

export function subject(id: string, username: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'user',
    username,
    email: username === null ? null : `${username}@example.test`,
    enabled: true,
    created_at: '2026-09-28T08:41:53.858Z',
    ...extra,
  };
}

export const ADA = subject(ADA_ID, 'ada');

const CLAIMS = [
  'name',
  'given_name',
  'family_name',
  'middle_name',
  'nickname',
  'preferred_username',
  'profile',
  'picture',
  'website',
  'gender',
  'birthdate',
  'zoneinfo',
  'locale',
  'phone_number',
  'address_formatted',
  'address_street',
  'address_locality',
  'address_region',
  'address_postal_code',
  'address_country',
];

export function profile(extra: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(CLAIMS.map((claim) => [claim, null])),
    email_verified: false,
    phone_number_verified: false,
    profile_updated_at: null,
    ...extra,
  };
}

export const NOT_LOCKED = {
  locked: false,
  locked_until: null,
  failure_count: 0,
  last_failure_at: null,
};

// grace of acme, holding the capabilities given, looking at ada.
export function subjectRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': whoami(capabilities),
    [`GET ${S}`]: json({ items: [ADA] }),
    [`GET ${S}/count`]: json({ count: 1, capped: false }),
    [`GET ${S}/${ADA_ID}`]: json(ADA, 200, { etag: '"s1"' }),
    [`GET ${S}/${ADA_ID}/profile`]: json(profile(), 200, { etag: '"p1"' }),
    [`GET ${S}/${ADA_ID}/credentials`]: json({ items: [] }),
    [`GET ${S}/${ADA_ID}/lockout`]: json(NOT_LOCKED),
    [`GET ${SETTINGS}`]: json({ username_editable: false }),
    ...extra,
  };
}

export function noContent(): Answer {
  return () => new Response(null, { status: 204 });
}
