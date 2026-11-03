import { expect, it } from 'vitest';
import {
  readAdminClients,
  readClientRoles,
} from '#/features/system-admins/adapter/administratorClients';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

it('reads the clients named odudu-admin and the roles of one client by name', async () => {
  const fake = fakeTransport({
    [`GET ${ACME_ADMIN}/clients`]: json({ items: [] }),
    [`GET ${ACME_ADMIN}/roles`]: json({ items: [] }),
  });
  await readAdminClients(fake.transport.gateway, 'acme');
  await readClientRoles(fake.transport.gateway, 'acme', 'c1', 'tenant-admin');
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
    'client_id=odudu-admin',
    'client=c1&name=tenant-admin',
  ]);
});
