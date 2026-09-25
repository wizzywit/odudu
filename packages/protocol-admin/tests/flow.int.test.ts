import {
  advance,
  authenticationSessionRepository,
  beginPasskeyAuthentication,
  completePasskeyEnrolment,
  registeredAuthenticatorNames,
  requiredActionRepository,
  startAuthentication,
} from '@odudu/authn-flows';
import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { subjectRepository, users } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { softwareAuthenticator, type SoftwareAuthenticator } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { replaceFlow, type FlowAuditEvent } from '#/usecase/flow';

const PUBLIC_BASE_URL = 'http://localhost:3000';
const RP_ID = 'localhost';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function getFlow(token: string, tenantName: string) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/flow/executions`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function putFlow(
  token: string,
  tenantName: string,
  steps: { authenticator: string; requirement: string }[],
) {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenantName}/flow/executions`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(steps),
  });
}

const loginRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256' as const,
};

async function enrolPasskey(
  tx: TenantScopedDatabase,
  tenantId: string,
  authenticator: SoftwareAuthenticator,
): Promise<string> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await tx.insert(users).values({ subjectId: subject.id, tenantId, username: `ada-${subject.id}` });
  await requiredActionRepository(tx).add(tenantId, subject.id, 'configure-passkey');
  const { authSessionId } = await startAuthentication(tx, tenantId, loginRequest);
  await authenticationSessionRepository(tx).bindSubject(authSessionId, subject.id);
  await authenticationSessionRepository(tx).setWebauthnChallenge(authSessionId, 'ZW5yb2wtbWU');
  const outcome = await completePasskeyEnrolment(tx, {
    tenantId,
    subjectId: subject.id,
    authSessionId,
    publicBaseUrl: PUBLIC_BASE_URL,
    response: authenticator.registration({
      challenge: 'ZW5yb2wtbWU',
      rpId: RP_ID,
      origin: PUBLIC_BASE_URL,
      signCount: 0,
    }),
  });
  if (outcome.kind !== 'enrolled') {
    throw new Error(`fixture: passkey enrolment did not succeed, got ${outcome.kind}`);
  }
  return subject.id;
}

async function loginWithAssertionOnly(
  tenantId: string,
  authenticator: SoftwareAuthenticator,
  signCount: number,
) {
  const authSessionId = await withTenant(fixture.app.db, tenantId, async (tx) => {
    const { authSessionId: id } = await startAuthentication(tx, tenantId, loginRequest);
    return id;
  });
  const offer = await withTenant(fixture.app.db, tenantId, (tx) =>
    beginPasskeyAuthentication(tx, { publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
  );
  const assertion = authenticator.assertion({
    challenge: offer.challenge,
    rpId: RP_ID,
    origin: PUBLIC_BASE_URL,
    signCount,
  });
  return withTenant(fixture.app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { assertion }, undefined, { publicBaseUrl: PUBLIC_BASE_URL }),
  );
}

describe('GET /admin/tenants/{t}/flow/executions', () => {
  it('returns the ordered list a newly provisioned tenant carries', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await getFlow(token, t.name);
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { index: number; authenticator: string }[] }>().items;
    expect(items.map((step) => [step.index, step.authenticator])).toEqual([
      [0, 'passkey'],
      [1, 'password'],
      [2, 'otp'],
      [3, 'recovery-code'],
    ]);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await getFlow(token, t.name);
      expect(res.statusCode, capability).toBe(403);
    }
  });
});

describe('PUT /admin/tenants/{t}/flow/executions', () => {
  it('replaces the flow, renumbering indices contiguously', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putFlow(token, t.name, [
      { authenticator: 'password', requirement: 'required' },
      { authenticator: 'otp', requirement: 'conditional' },
    ]);
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { index: number; authenticator: string }[] }>().items;
    expect(items.map((step) => [step.index, step.authenticator])).toEqual([
      [0, 'password'],
      [1, 'otp'],
    ]);

    const after = await getFlow(token, t.name);
    expect(after.json<{ items: { index: number }[] }>().items.map((step) => step.index)).toEqual([
      0, 1,
    ]);
  });

  it('400s an authenticator name the registry does not resolve, naming the known ones', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putFlow(token, t.name, [{ authenticator: 'bogus', requirement: 'required' }]);
    expect(res.statusCode).toBe(400);
    const body = res.json<{ detail: string }>();
    for (const name of registeredAuthenticatorNames()) {
      expect(body.detail).toContain(name);
    }
  });

  it('400s an empty list, since a tenant with no flow cannot be logged into', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putFlow(token, t.name, []);
    expect(res.statusCode).toBe(400);
  });

  it('400s a list where every step is disabled', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putFlow(token, t.name, [
      { authenticator: 'password', requirement: 'disabled' },
      { authenticator: 'otp', requirement: 'disabled' },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await putFlow(token, t.name, [
        { authenticator: 'password', requirement: 'required' },
      ]);
      expect(res.statusCode, capability).toBe(403);
    }
  });

  // The test that matters: this proves the PUT's configuration reaches the
  // executor a real login runs against, not only the table a GET reads
  // back. A bare `initialChallenge` can't distinguish the two orders —
  // passkey is inapplicable with nothing submitted regardless of position —
  // so the proof submits an assertion alone: `password` is unconditionally
  // applicable, so it intercepts the assertion when listed first, and the
  // same assertion signs the subject in via passkey once passkey is first.
  it('reorders passkey before password, and a real login offers passkey first', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const authenticator = softwareAuthenticator();
    const subjectId = await withTenant(fixture.app.db, t.id, (tx) =>
      enrolPasskey(tx, t.id, authenticator),
    );

    const withPasswordFirst = await putFlow(token, t.name, [
      { authenticator: 'password', requirement: 'alternative' },
      { authenticator: 'passkey', requirement: 'alternative' },
    ]);
    expect(withPasswordFirst.statusCode).toBe(200);

    const interceptedByPassword = await loginWithAssertionOnly(t.id, authenticator, 1);
    expect(interceptedByPassword).toEqual({ kind: 'challenge', form: 'password' });

    const withPasskeyFirst = await putFlow(token, t.name, [
      { authenticator: 'passkey', requirement: 'alternative' },
      { authenticator: 'password', requirement: 'alternative' },
    ]);
    expect(withPasskeyFirst.statusCode).toBe(200);

    const wonByPasskey = await loginWithAssertionOnly(t.id, authenticator, 2);
    expect(wonByPasskey).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
  });
});

describe('audit', () => {
  function collector(): {
    events: FlowAuditEvent[];
    audit: (tx: TenantScopedDatabase, e: FlowAuditEvent) => Promise<void>;
  } {
    const events: FlowAuditEvent[] = [];
    return {
      events,
      audit: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('calls audit exactly once on a successful replace, and not on a refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);

    const ok = collector();
    const replaced = await withTenant(fixture.app.db, t.id, (tx) =>
      replaceFlow(
        tx,
        { audit: ok.audit },
        {
          tenantId: t.id,
          steps: [{ authenticator: 'password', requirement: 'required' }],
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(replaced.kind).toBe('ok');
    expect(ok.events).toHaveLength(1);
    expect(ok.events[0]?.action).toBe('flow.replace');

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      replaceFlow(
        tx,
        { audit: refused.audit },
        {
          tenantId: t.id,
          steps: [],
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('empty');
    expect(refused.events).toHaveLength(0);
  });
});
