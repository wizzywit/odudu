import { json, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { graceRoutes } from '#/testing/renderConsole';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';

export const SESSIONS = `${ACME_ADMIN}/sessions`;

const DEVICE = '7e5d3b1f9a8c6e4d2b0a98f7e6d5c4b3a2918f7e6d5c4b3a29181f0e0d0c0b0a';

export function session(id: string, username: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    subject_id: `sub-${id}`,
    username,
    created_at: '2026-10-12T08:00:00.000Z',
    last_active_at: '2026-10-12T09:30:00.000Z',
    remembered: false,
    client_ids: ['odudu-admin'],
    device: DEVICE,
    ...extra,
  };
}

export const SESSION_ADA = session('s-ada', 'ada');
export const SESSION_NAMELESS = session('s-bot', null, {
  remembered: true,
  client_ids: [],
  device: null,
});

// grace of acme holding the capabilities given, with two live sessions.
export function sessionRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    { [`GET ${SESSIONS}`]: json({ items: [SESSION_ADA, SESSION_NAMELESS] }) },
    extra,
  );
}
