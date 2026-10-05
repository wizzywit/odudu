import { expect, it } from 'vitest';
import {
  sendActionsEmail,
  sendPasswordReset,
  sendVerification,
} from '#/features/subjects/adapter/mail.ts';
import { fakeTransport } from '#/testing/fakeTransport.ts';

const S = '/console/api/admin/tenants/acme/subjects/s1';
const accepted = () => () => new Response(null, { status: 202 });

it('asks for each mail by its own route, and sends the actions link its body', async () => {
  const fake = fakeTransport({
    [`POST ${S}/password-reset`]: accepted(),
    [`POST ${S}/verification`]: accepted(),
    [`POST ${S}/actions-email`]: accepted(),
  });
  const gateway = fake.transport.gateway;
  expect(await sendPasswordReset(gateway, 'acme', 's1')).toMatchObject({ ok: true, status: 202 });
  expect(await sendVerification(gateway, 'acme', 's1')).toMatchObject({ ok: true });
  await sendActionsEmail(gateway, 'acme', 's1', { actions: ['configure-totp'] });
  await sendActionsEmail(gateway, 'acme', 's1', { actions: ['update-password'] });
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    undefined,
    undefined,
    { actions: ['configure-totp'] },
    { actions: ['update-password'] },
  ]);
});
