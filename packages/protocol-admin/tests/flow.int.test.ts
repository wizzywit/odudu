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
import { startAdminFixture, type AdminFixture, etagAt } from '#/testing/admin-fixture';
import { listFlow, replaceFlow, type FlowAuditEvent } from '#/usecase/flow';

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

async function putFlow(
  token: string,
  tenantName: string,
  steps: { authenticator: string; requirement: string; settings?: Record<string, unknown> }[],
) {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenantName}/flow/executions`,
    headers: {
      'if-match': await etagAt(fixture.http, `/admin/tenants/${tenantName}/flow/executions`, token),
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
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
    beginPasskeyAuthentication(tx, { tenantId, publicBaseUrl: PUBLIC_BASE_URL, authSessionId }),
  );
  const assertion = authenticator.assertion({
    challenge: offer.challenge,
    rpId: RP_ID,
    origin: PUBLIC_BASE_URL,
    signCount,
  });
  return withTenant(fixture.app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { assertion }, undefined, {
      logger: { error: (): void => undefined },
      publicBaseUrl: PUBLIC_BASE_URL,
    }),
  );
}

describe('the authenticators a flow can name', () => {
  it('come with the flow, on a read and on a write, from the registry itself', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const read = await getFlow(token, t.name);
    expect(read.json<{ available: string[] }>().available).toEqual([
      ...registeredAuthenticatorNames(),
    ]);

    const written = await putFlow(token, t.name, [
      { authenticator: 'password', requirement: 'required' },
    ]);
    expect(written.statusCode, written.body).toBe(200);
    expect(written.json<{ available: string[] }>().available).toEqual([
      ...registeredAuthenticatorNames(),
    ]);
  });
});

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

  // At login start no subject is bound, so a conditional otp step stands
  // down and a conditional recovery-code step is inapplicable — every group
  // counts as satisfied and `initialChallenge` answers
  // no_applicable_execution. Shape validation alone lets this through.
  it('400s a flow whose every step stands down before a subject is bound', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putFlow(token, t.name, [
      { authenticator: 'otp', requirement: 'conditional' },
      { authenticator: 'recovery-code', requirement: 'conditional' },
    ]);

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/start of a login/u);
  });

  it('400s a flow that begins with a step no first request could answer', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putFlow(token, t.name, [
      { authenticator: 'otp', requirement: 'required' },
      { authenticator: 'password', requirement: 'required' },
    ]);

    expect(res.statusCode).toBe(400);
  });

  it('accepts a conditional step once something runnable precedes it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putFlow(token, t.name, [
      { authenticator: 'password', requirement: 'required' },
      { authenticator: 'otp', requirement: 'conditional' },
    ]);

    expect(res.statusCode).toBe(200);
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
    expect(body.detail).toMatch(/^unknown authenticator "bogus"; expected one of /u);
  });

  it('round-trips a step’s settings through GET and PUT, and refuses ones it does not read', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const steps = [
      { authenticator: 'password', requirement: 'required' },
      { authenticator: 'otp', requirement: 'required', settings: { digits: 8, period: 60 } },
    ];
    const written = await putFlow(token, t.name, steps);
    expect(written.statusCode, written.body).toBe(200);
    expect(written.json<{ items: { settings?: unknown }[] }>().items[1]?.settings).toEqual({
      digits: 8,
      period: 60,
    });
    const read = await getFlow(token, t.name);
    expect(read.json<{ items: { settings?: unknown }[] }>().items[1]?.settings).toEqual({
      digits: 8,
      period: 60,
    });

    const refused = await putFlow(token, t.name, [
      { authenticator: 'password', requirement: 'required', settings: { digits: 8 } },
    ]);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ type: string; errors: { path: string }[] }>()).toMatchObject({
      type: 'about:blank#flow-step-settings',
      errors: [{ path: '[0].settings' }],
    });
  });

  // The console tells the five refusals apart by type, and reads the step at
  // fault from `errors[]` for the two that name one.
  it('gives each refusal its own type, with the detail and errors as before', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const refusal = async (steps: { authenticator: string; requirement: string }[]) =>
      (await putFlow(token, t.name, steps)).json<{
        type: string;
        detail: string;
        errors?: { path: string; message: string }[];
      }>();

    expect((await refusal([])).type).toBe('about:blank#flow-empty');
    expect((await refusal([{ authenticator: 'password', requirement: 'disabled' }])).type).toBe(
      'about:blank#flow-no-enabled-step',
    );
    expect((await refusal([{ authenticator: 'passkey', requirement: 'required' }])).type).toBe(
      'about:blank#flow-no-first-challenge',
    );
    const unknown = await refusal([{ authenticator: 'bogus', requirement: 'required' }]);
    expect(unknown.type).toBe('about:blank#flow-unknown-authenticator');
    expect(unknown.errors?.[0]?.path).toBe('[0].authenticator');
    expect(unknown.detail).toMatch(/^unknown authenticator "bogus"; expected one of /u);
    const repeated = await refusal([
      { authenticator: 'password', requirement: 'required' },
      { authenticator: 'password', requirement: 'required' },
    ]);
    expect(repeated.type).toBe('about:blank#flow-duplicate-authenticator');
    expect(repeated.errors?.[0]?.path).toBe('[1].authenticator');
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

describe('making another flow the default', () => {
  async function makeDefault(token: string, tenantName: string, name: string, steps: unknown) {
    const base = `/admin/tenants/${tenantName}/flows`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const created = await fixture.http.inject({
      method: 'POST',
      url: base,
      headers,
      payload: JSON.stringify({ name, steps }),
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    const promoted = await fixture.http.inject({
      method: 'POST',
      url: `${base}/${id}/make-default`,
      headers: {
        authorization: headers.authorization,
        'if-match': await etagAt(fixture.http, `${base}/${id}`, token),
      },
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
  }

  const passwordFirst = [
    { authenticator: 'password', requirement: 'alternative' },
    { authenticator: 'passkey', requirement: 'alternative' },
  ];
  const passkeyFirst = [
    { authenticator: 'passkey', requirement: 'alternative' },
    { authenticator: 'password', requirement: 'alternative' },
  ];

  it('is followed by the next sign-in, which runs the promoted flow', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const authenticator = softwareAuthenticator();
    const subjectId = await withTenant(fixture.app.db, t.id, (tx) =>
      enrolPasskey(tx, t.id, authenticator),
    );
    await makeDefault(token, t.name, 'password-first', passwordFirst);
    expect(await loginWithAssertionOnly(t.id, authenticator, 1)).toEqual({
      kind: 'challenge',
      form: 'password',
    });

    await makeDefault(token, t.name, 'passkey-first', passkeyFirst);
    expect(await loginWithAssertionOnly(t.id, authenticator, 2)).toEqual({
      kind: 'success',
      subjectId,
      authenticators: ['passkey'],
    });
  });

  // An authentication records what it satisfied by authenticator name and not
  // which flow it started on, so one in flight takes its next step from the
  // flow that is the default when that step is asked.
  it('moves an authentication already in flight to the promoted flow at its next step', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const authenticator = softwareAuthenticator();
    const subjectId = await withTenant(fixture.app.db, t.id, (tx) =>
      enrolPasskey(tx, t.id, authenticator),
    );
    await makeDefault(token, t.name, 'password-first', passwordFirst);
    const authSessionId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const { authSessionId: id } = await startAuthentication(tx, t.id, loginRequest);
      return id;
    });

    await makeDefault(token, t.name, 'passkey-first', passkeyFirst);
    const offer = await withTenant(fixture.app.db, t.id, (tx) =>
      beginPasskeyAuthentication(tx, {
        tenantId: t.id,
        publicBaseUrl: PUBLIC_BASE_URL,
        authSessionId,
      }),
    );
    const assertion = authenticator.assertion({
      challenge: offer.challenge,
      rpId: RP_ID,
      origin: PUBLIC_BASE_URL,
      signCount: 1,
    });
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      advance(tx, authSessionId, { assertion }, undefined, {
        logger: { error: (): void => undefined },
        publicBaseUrl: PUBLIC_BASE_URL,
      }),
    );
    expect(outcome).toEqual({ kind: 'success', subjectId, authenticators: ['passkey'] });
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
    const ifMatch = (await withTenant(fixture.app.db, t.id, (tx) => listFlow(tx, t.id))).etag;
    const replaced = await withTenant(fixture.app.db, t.id, (tx) =>
      replaceFlow(
        tx,
        { audit: ok.audit },
        {
          tenantId: t.id,
          steps: [{ authenticator: 'password', requirement: 'required' }],
          ifMatch,
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
    const current = (await withTenant(fixture.app.db, t.id, (tx) => listFlow(tx, t.id))).etag;
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      replaceFlow(
        tx,
        { audit: refused.audit },
        {
          tenantId: t.id,
          steps: [],
          ifMatch: current,
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
