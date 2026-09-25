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
      starttls: true,
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
      starttls: true,
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
      starttls: true,
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

describe('PUT /admin/tenants/{t}/smtp requires TLS wherever it authenticates', () => {
  it('refuses a username with starttls off, rather than putting it on the wire', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putSmtp(token, t.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      username: 'ada',
      password: 'hunter2',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/starttls/u);
  });

  it('refuses a password with starttls off for the same reason', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putSmtp(token, t.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      password: 'hunter2',
      starttls: false,
    });

    expect(res.statusCode).toBe(400);
  });

  it('accepts the same configuration once starttls is on', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await putSmtp(token, t.name, {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'noreply@example.test',
      username: 'ada',
      password: 'hunter2',
      starttls: true,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ starttls: true, password_set: true });
  });
});

describe('POST /admin/tenants/{t}/smtp/test', () => {
  it('will not connect to a loopback host, so it cannot probe this server', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await putSmtp(token, t.name, {
      host: '127.0.0.1',
      port: 5432,
      from_address: 'noreply@example.test',
    });

    const res = await testSmtp(token, t.name, 'ops@example.test');

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/loopback/u);
  });

  it('will not connect to the link-local metadata address', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await putSmtp(token, t.name, {
      host: '169.254.169.254',
      port: 80,
      from_address: 'noreply@example.test',
    });

    const res = await testSmtp(token, t.name, 'ops@example.test');

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/link-local/u);
  });

  it('refuses a host that does not resolve rather than reporting the resolver error', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await putSmtp(token, t.name, {
      host: 'unreachable.invalid',
      port: 587,
      from_address: 'noreply@example.test',
    });

    const res = await testSmtp(token, t.name, 'ops@example.test');

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/resolves to no address/u);
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
          audit: (_tx, event) => {
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
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('tenant.smtp_set');
  });

  // The over-long password is refused at the route, before putSmtp's own
  // usecase — and its audit call — ever runs. This asserts only the visible
  // consequence: the tenant is left exactly as unconfigured as before.
  it('leaves the tenant unconfigured when the refusal never reaches the usecase', async () => {
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

describe('DELETE /admin/tenants/{t}/smtp', () => {
  function deleteSmtp(token: string, tenantName: string) {
    return fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${tenantName}/smtp`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it('removes the row, so the tenant falls back to the deployment sender', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    expect(
      (await putSmtp(token, t.name, { host: 'smtp.example', port: 587, from_address: 'a@b.test' }))
        .statusCode,
    ).toBe(200);

    const res = await deleteSmtp(token, t.name);
    expect(res.statusCode).toBe(204);

    const read = await getSmtp(token, t.name);
    expect(read.json<{ configured: boolean }>().configured).toBe(false);
    const row = await withTenant(fixture.app.db, t.id, (tx) =>
      tenantSmtpRepository(tx).byTenantId(t.id),
    );
    expect(row).toBeNull();
  });

  it('404s when the tenant has no configuration to remove', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await deleteSmtp(token, t.name);
    expect(res.statusCode).toBe(404);
  });

  it('cannot reach another tenant, which keeps its own row', async () => {
    const owner = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    const ownerToken = await fixture.adminToken(owner.name, ['manage-tenant']);
    const otherToken = await fixture.adminToken(other.name, ['manage-tenant']);
    await putSmtp(ownerToken, owner.name, {
      host: 'smtp.example',
      port: 587,
      from_address: 'a@b.test',
    });

    expect((await deleteSmtp(otherToken, other.name)).statusCode).toBe(404);
    const row = await withTenant(fixture.app.db, owner.id, (tx) =>
      tenantSmtpRepository(tx).byTenantId(owner.id),
    );
    expect(row).not.toBeNull();
  });

  it('records one audit row for the removal and none for the 404', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'view-audit']);

    expect((await deleteSmtp(token, t.name)).statusCode).toBe(404);
    await putSmtp(token, t.name, { host: 'smtp.example', port: 587, from_address: 'a@b.test' });
    expect((await deleteSmtp(token, t.name)).statusCode).toBe(204);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit`,
      headers: { authorization: `Bearer ${token}` },
    });
    const removals = audit
      .json<{ items: { action: string }[] }>()
      .items.filter((item) => item.action === 'tenant.smtp_delete');
    expect(removals).toHaveLength(1);
  });
});
