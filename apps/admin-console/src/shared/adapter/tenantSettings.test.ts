import { expect, it } from 'vitest';
import settings from '#/shared/adapter/fixtures/settings.json';
import { readTenantSettings } from '#/shared/adapter/tenantSettings';
import { fakeTransport, json } from '#/testing/fakeTransport';

it('reads the settings of a tenant as the one record the server keeps', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/settings': json(settings, 200, { etag: '"s1"' }),
  });
  const result = await readTenantSettings(fake.transport.gateway, 'acme');
  expect(result).toMatchObject({ ok: true, etag: '"s1"' });
  expect(result.ok ? result.data : undefined).toEqual(settings);
});
