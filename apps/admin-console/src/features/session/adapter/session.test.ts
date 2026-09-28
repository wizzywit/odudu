import { expect, it } from 'vitest';
import { readAuthority, readSession } from '#/features/session/adapter/session.ts';
import { createSessionEvents } from '#/shared/service/sessionEvents.ts';
import { createGateway, type Fetch } from '#/shared/transport/gateway.ts';

function gatewayAnswering(body: unknown, urls: string[] = []) {
  const answer: Fetch = (url) => {
    urls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
    );
  };
  return createGateway({ fetch: answer, events: createSessionEvents(), log: () => undefined });
}

it('reads the session the gateway reports, as the principal', async () => {
  const urls: string[] = [];
  const result = await readSession(
    gatewayAnswering({ tenant: 'acme', subject_id: 's1', username: 'grace' }, urls),
  );
  expect(urls).toEqual(['/console/api/session']);
  expect(result).toMatchObject({
    ok: true,
    data: { tenant: 'acme', subjectId: 's1', username: 'grace' },
  });
});

it('refuses a session body missing its subject', async () => {
  const result = await readSession(gatewayAnswering({ tenant: 'acme', username: 'grace' }));
  expect(result).toEqual({ ok: false, kind: 'schema' });
});

it("reads whoami on the tenant in the path, through the contract's schema", async () => {
  const urls: string[] = [];
  const result = await readAuthority(
    gatewayAnswering(
      {
        subjectId: 's1',
        issuerTenantId: 't1',
        capabilities: ['view-users', 'manage-tenants'],
        crossTenant: true,
      },
      urls,
    ),
    'acme',
  );
  expect(urls).toEqual(['/console/api/admin/tenants/acme/whoami']);
  expect(result).toMatchObject({
    ok: true,
    data: { capabilities: ['view-users', 'manage-tenants'], crossTenant: true },
  });
});

it('refuses a capability the contract does not name', async () => {
  const result = await readAuthority(
    gatewayAnswering({
      subjectId: 's1',
      issuerTenantId: 't1',
      capabilities: ['rule-the-world'],
      crossTenant: false,
    }),
    'acme',
  );
  expect(result).toEqual({ ok: false, kind: 'schema' });
});
