import { expect, it } from 'vitest';
import { smtpSave } from '#/pages/email/repository/smtpSave';
import { relayValues } from '#/pages/email/services/relay';
import { fakeTransport } from '#/testing/fakeTransport';
import { OWN_SMTP, smtpAnswer, SM } from '#/testing/settingsFixtures';
import { smtpConfigSchema } from '@odudu/contracts/admin';

const values = relayValues(smtpConfigSchema.parse(OWN_SMTP));

it('replaces the relay on the ETag it was read with, leaving the password out to keep it', async () => {
  const { transport, sent } = fakeTransport({ [`PUT ${SM}`]: smtpAnswer(OWN_SMTP, '"m2"') });
  const result = await smtpSave('acme')(transport.gateway, {
    changes: {},
    values,
    ifMatch: '"m1"',
  });
  expect(result).toMatchObject({ ok: true, etag: '"m2"' });
  expect(sent[0]).toMatchObject({ method: 'PUT', ifMatch: '"m1"' });
  expect(Object.hasOwn(sent[0]?.body as object, 'password')).toBe(false);
});

it('sends the password to replace it and null to clear it', async () => {
  const { transport, sent } = fakeTransport({ [`PUT ${SM}`]: smtpAnswer() });
  const save = smtpSave('acme');
  await save(transport.gateway, {
    changes: {},
    values: { ...values, password: 'new' },
    ifMatch: '"m1"',
  });
  await save(transport.gateway, {
    changes: {},
    values: { ...values, remove_password: true },
    ifMatch: '"m1"',
  });
  expect(sent.map((s) => (s.body as { password?: unknown }).password)).toEqual(['new', null]);
});
