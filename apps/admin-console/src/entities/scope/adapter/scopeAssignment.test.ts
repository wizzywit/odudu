import { expect, it } from 'vitest';
import assigned from '#/entities/scope/adapter/fixtures/assigned.json';
import { assignScope, unassignScope } from '#/entities/scope/adapter/scopeAssignment';
import { fakeTransport, json } from '#/testing/fakeTransport';

const ROUTE = `/console/api/admin/tenants/acme/scopes/s%201/clients/${assigned.client_id}`;

it('assigns a scope to a client with the assignment as the body, and answers the left scopes', async () => {
  const fake = fakeTransport({ [`PUT ${ROUTE}`]: json(assigned) });
  const result = await assignScope(
    fake.transport.gateway,
    'acme',
    's 1',
    assigned.client_id,
    'optional',
  );
  expect(result).toMatchObject({ ok: true, data: assigned });
  expect(fake.sent[0]?.body).toEqual({ assignment: 'optional' });
});

it('unassigns it with a DELETE to the same route', async () => {
  const fake = fakeTransport({ [`DELETE ${ROUTE}`]: () => new Response(null, { status: 204 }) });
  expect(
    await unassignScope(fake.transport.gateway, 'acme', 's 1', assigned.client_id),
  ).toMatchObject({ ok: true });
});
