import { expect, it } from 'vitest';
import { clearTenantLockouts } from '#/features/settings/adapter/lockouts';
import { fakeTransport, json } from '#/testing/fakeTransport';

const PATH = 'DELETE /console/api/admin/tenants/acme/lockouts';

// The body is the one `delete-lockouts.md` shows for the clear of two subjects.
it('clears every lockout of the tenant and reads the three counts it answers with', async () => {
  const fake = fakeTransport({ [PATH]: json({ cleared: 2, beyond_ceiling: 0, remaining: 0 }) });
  expect(await clearTenantLockouts(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: { cleared: 2, beyond_ceiling: 0, remaining: 0 },
  });
  expect(fake.sent.map((sent) => sent.method)).toEqual(['DELETE']);
});

it('reads the answer of a clear that left some beyond the ceiling and some for the next call', async () => {
  const fake = fakeTransport({ [PATH]: json({ cleared: 4, beyond_ceiling: 1, remaining: 2 }) });
  expect(await clearTenantLockouts(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: { cleared: 4, beyond_ceiling: 1, remaining: 2 },
  });
});

it('refuses an answer that leaves out what remains', async () => {
  const fake = fakeTransport({ [PATH]: json({ cleared: 2, beyond_ceiling: 0 }) });
  expect(await clearTenantLockouts(fake.transport.gateway, 'acme')).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});
