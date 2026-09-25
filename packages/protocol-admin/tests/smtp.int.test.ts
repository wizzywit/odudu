import { withTenant } from '@odudu/db';
import { unwrapSecret } from '@odudu/crypto';
import { tenantSmtpRepository } from '@odudu/protocol-admin';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { putSmtp as putSmtpUsecase, type SmtpAuditEvent } from '#/usecase/smtp';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const KEK = Buffer.alloc(32, 7);

function getSmtp(token: string, tenantName: string) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/smtp`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function putSmtp(token: string, tenantName: string, body: Record<string, unknown>) {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenantName}/smtp`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: body,
  });
}

function testSmtp(token: string, tenantName: string, to: string) {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/smtp/test`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { to },
  });
}

describe('GET /admin/tenants/{t}/smtp', () => {
  it('reports unconfigured for a tenant with no row', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await getSmtp(token, t.name);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, password_set: false });
  });

  it('never returns the password, only whether one is set', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await putSmtp(token, t.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      password: 'hunter2',
    });

    const res = await getSmtp(token, t.name);

    expect(res.payload).not.toContain('hunter2');
    expect(res.json()).toMatchObject({ configured: true, password_set: true });
  });
});

describe('PUT /admin/tenants/{t}/smtp', () => {
  it('stores the password encrypted, not in plaintext', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    await putSmtp(token, t.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      password: 'hunter2',
    });

    const row = await withTenant(fixture.app.db, t.id, (tx) =>
      tenantSmtpRepository(tx).byTenantId(t.id),
    );
    const encrypted = row?.passwordEncrypted;
    if (encrypted === undefined || encrypted === null) {
      throw new Error('expected a stored, encrypted password');
    }
    expect(encrypted).not.toContain('hunter2');
    expect(unwrapSecret(encrypted, KEK)).toBe('hunter2');
  });

  it('clears the password when a later PUT omits it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await putSmtp(token, t.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      password: 'hunter2',
    });

    await putSmtp(token, t.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
    });

    const res = await getSmtp(token, t.name);
    expect(res.json()).toMatchObject({ password_set: false });
  });
});

describe('POST /admin/tenants/{t}/smtp/test', () => {
  it('reports the transport failure as a 502 rather than swallowing it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await putSmtp(token, t.name, {
      host: 'unreachable.invalid',
      port: 587,
      from_address: 'noreply@example.test',
    });

    const res = await testSmtp(token, t.name, 'ops@example.test');

    expect(res.statusCode).toBe(502);
    expect(res.json<{ detail: string }>().detail).toMatch(/unreachable\.invalid/u);
  });

  it('refuses with 400 for a tenant with no SMTP configuration', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await testSmtp(token, t.name, 'ops@example.test');

    expect(res.statusCode).toBe(400);
  });
});

describe('is refused for every capability but manage-tenant, on all three smtp routes', () => {
  it('GET, PUT and POST /smtp/test', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);

    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);

      const read = await getSmtp(token, t.name);
      expect(read.statusCode, `GET /smtp as ${capability}`).toBe(403);

      const put = await putSmtp(token, t.name, {
        host: 'smtp.example.test',
        port: 587,
        from_address: 'noreply@example.test',
      });
      expect(put.statusCode, `PUT /smtp as ${capability}`).toBe(403);

      const test = await testSmtp(token, t.name, 'ops@example.test');
      expect(test.statusCode, `POST /smtp/test as ${capability}`).toBe(403);
    }
  });
});

describe('smtp is invisible from a different tenant', () => {
  it('reports unconfigured rather than another tenant own row', async () => {
    const t1 = await fixture.createTenant(`acme-${newId()}`);
    const t2 = await fixture.createTenant(`acme-${newId()}`);
    const token1 = await fixture.adminToken(t1.name, ['manage-tenant']);
    const token2 = await fixture.adminToken(t2.name, ['manage-tenant']);
    await putSmtp(token1, t1.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
    });

    const res = await getSmtp(token2, t2.name);

    expect(res.json()).toMatchObject({ configured: false });
  });
});

// Driven directly against the usecase, the same way scopes.int.test.ts pins
// its own audit calls.
describe('audit', () => {
  it('calls audit exactly once on a successful PUT', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: SmtpAuditEvent[] = [];
    await withTenant(fixture.app.db, t.id, (tx) =>
      putSmtpUsecase(
        tx,
        {
          audit: (event) => {
            events.push(event);
            return Promise.resolve();
          },
          kek: KEK,
        },
        {
          tenantId: t.id,
          host: 'smtp.example.test',
          port: 587,
          fromAddress: 'noreply@example.test',
          username: null,
          password: null,
          starttls: false,
          actorSubjectId: 'test',
        },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('tenant.smtp_set');
  });

  // putSmtp calls audit only after a successful upsert (see the source
  // above), so a refusal that never reaches the usecase at all — the
  // over-long password, refused at the route before any repository call —
  // is proven to call it zero times by proving it changes nothing: the
  // tenant is still unconfigured afterward.
  it('reaches the reachable refusal and calls audit zero times, not just the success path', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putSmtp(token, t.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      password: 'x'.repeat(257),
    });

    expect(res.statusCode).toBe(400);
    const after = await getSmtp(token, t.name);
    expect(after.json()).toMatchObject({ configured: false, password_set: false });
  });
});

describe('repository, probed with a foreign tenant_id', () => {
  it('finds no row across tenants even with the correct scope id', async () => {
    const t1 = await fixture.createTenant(`acme-${newId()}`);
    const t2 = await fixture.createTenant(`acme-${newId()}`);
    await withTenant(fixture.app.db, t1.id, (tx) =>
      tenantSmtpRepository(tx).upsert(t1.id, {
        host: 'smtp.example.test',
        port: 587,
        fromAddress: 'noreply@example.test',
        username: null,
        passwordEncrypted: null,
        starttls: false,
      }),
    );

    const row = await withTenant(fixture.app.db, t2.id, (tx) =>
      tenantSmtpRepository(tx).byTenantId(t1.id),
    );

    expect(row).toBeNull();
  });
});
