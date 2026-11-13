import { json, type Answer } from '#/testing/fakeTransport';
import { ADMIN_ROLES, EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { graceRoutes } from '#/testing/renderConsole';

export const S = `${ACME_ADMIN}/subjects`;
export const POLICY = `${ACME_ADMIN}/subjects/username-policy`;
export const ADA_ID = '01a0e72d-7fc7-7950-a1e7-1d079588f8b4';
export const ADA_AT = `/console/acme/subjects/${ADA_ID}`;

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

export function group(id: string, path: string, description: string | null = null) {
  const name = path.split('/').at(-1) ?? path;
  return {
    id,
    name,
    description,
    parent_id: null,
    default_for_new_subjects: false,
    path,
    created_at: '2026-09-28T08:41:53.858Z',
    admin_reach: [],
  };
}

export function assigned(r: {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
}) {
  return { id: r.id, name: r.name, client_id: r.client_id, client_key: r.client_key };
}

// grace of acme, holding the capabilities given, looking at ada.
export function subjectRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    {
      [`GET ${S}`]: json({ items: [ADA] }),
      [`GET ${S}/count`]: json({ count: 1, capped: false }),
      [`GET ${S}/${ADA_ID}`]: json(ADA, 200, { etag: '"s1"' }),
      [`GET ${S}/${ADA_ID}/profile`]: json(profile(), 200, { etag: '"p1"' }),
      [`GET ${S}/${ADA_ID}/credentials`]: json({ items: [] }),
      [`GET ${S}/${ADA_ID}/lockout`]: json(NOT_LOCKED),
      [`GET ${POLICY}`]: json({ username_editable: false }),
      [`GET ${S}/${ADA_ID}/groups`]: json({ items: [] }, 200, { etag: '"g0"' }),
      [`GET ${S}/${ADA_ID}/roles`]: json({ items: [] }, 200, { etag: '"r0"' }),
      [`GET ${S}/${ADA_ID}/effective-roles`]: json({ items: [] }),
      [`GET ${S}/${ADA_ID}/admin-capabilities`]: json({ items: [], complete: true }),
      // grace herself, for a test of her own record.
      [`GET ${S}/s1/effective-roles`]: json({ items: [] }),
      [`GET ${S}/s1/admin-capabilities`]: json({ items: [], complete: true }),
      [`GET ${S}/${ADA_ID}/required-actions`]: json({ actions: [] }, 200, { etag: '"a0"' }),
      [`GET ${S}/${ADA_ID}/sessions`]: json({ items: [] }),
      [`GET ${S}/${ADA_ID}/consents`]: json({ items: [] }),
      [`GET ${S}/${ADA_ID}/terms-acceptances`]: json({ items: [] }),
      [`GET ${S}/${ADA_ID}/grants`]: json({ items: [] }),
      [`GET ${ACME_ADMIN}/audit`]: json({ items: [] }),
      [`GET ${ACME_ADMIN}/groups`]: json({ items: [] }),
      [`GET ${ACME_ADMIN}/roles`]: (request) =>
        json({
          items:
            request.search.get('client') === 'c-odudu-admin'
              ? ADMIN_ROLES
              : request.search.get('name') === 'tenant-admin'
                ? ADMIN_ROLES.slice(0, 1)
                : [],
        })(request),
    },
    extra,
  );
}

export function noContent(): Answer {
  return () => new Response(null, { status: 204 });
}
