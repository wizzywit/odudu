import type { Domain } from '#/pages/domains/types/domain';
import { json, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { graceRoutes } from '#/testing/renderConsole';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';

export const DOMAINS = `${ACME_ADMIN}/domains`;
export const IMPACT = `${DOMAINS}/passkey-impact`;

export function domain(id: string, state: Domain['state'], extra: Partial<Domain> = {}): Domain {
  return {
    id,
    host: `${id}.acme.com`,
    state,
    canonical: false,
    verified_at: state === 'verified' ? '2026-11-01T09:00:00.000Z' : null,
    last_checked_at: '2026-11-02T09:00:00.000Z',
    dns_record: null,
    ...extra,
  };
}

export const PENDING = domain('pending', 'pending', {
  dns_record: { name: '_odudu-challenge.pending.acme.com', value: 'odudu-verify=9f3c0a1e' },
});
export const VERIFIED = domain('login', 'verified');
export const FAILED = domain('lost', 'failed');
export const ADDRESS = domain('www', 'verified', { canonical: true });

export const PATH_ETAG = '"path"';

// What the tenant's one precondition reads as while no domain is its address.
export function listAnswer(
  items: readonly unknown[],
  etag: string = PATH_ETAG,
  extra: Record<string, unknown> = {},
): Answer {
  return json({ items, ...extra }, 200, { etag });
}

// grace of acme holding the capabilities given, with a pending, a verified and a failed domain.
export function domainRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
  items: readonly unknown[] = [PENDING, VERIFIED, FAILED],
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    {
      [`GET ${DOMAINS}`]: listAnswer(items),
      [`GET ${IMPACT}`]: json({ subjects: 0, capped: false }),
    },
    extra,
  );
}
