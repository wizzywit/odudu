import { expect, it } from 'vitest';
import { readSmtp } from '#/entities/mail-relay/adapter/mailRelay';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { SM } from '#/testing/settingsFixtures';

// Both bodies are those of get-smtp-put-smtp-delete-smtp-and-post-smtptest.md, verbatim:
// the read of a tenant with no row, and the read after the PUT that stored a relay.
const UNCONFIGURED = {
  configured: false,
  host: null,
  port: null,
  from_address: null,
  username: null,
  password_set: false,
  starttls: null,
  effective: 'none',
};
const STORED = {
  configured: true,
  host: 'smtp.example.test',
  port: 587,
  from_address: 'noreply@demo.example',
  username: null,
  password_set: true,
  starttls: true,
  effective: 'tenant',
};
const TAG = '"eb513a27e14a9d51bb5c40764b9054c6c4b4ff6de3ce14b3eb4cf4745589d891"';

it('reads the relay of a tenant that has none, as unconfigured and sent nowhere', async () => {
  const fake = fakeTransport({ [`GET ${SM}`]: json(UNCONFIGURED, 200, { etag: TAG }) });
  const result = await readSmtp(fake.transport.gateway, 'acme');
  expect(result).toMatchObject({ ok: true, data: UNCONFIGURED, etag: TAG });
  expect(fake.sent[0]).toMatchObject({ method: 'GET', path: SM });
});

it('reads a stored relay with whether a password is set, never the password', async () => {
  const fake = fakeTransport({ [`GET ${SM}`]: json(STORED) });
  const result = await readSmtp(fake.transport.gateway, 'acme');
  expect(result).toMatchObject({ ok: true, data: STORED });
  expect(JSON.stringify(result)).not.toContain('hunter2');
});

it('refuses a relay that names no source for the mail', async () => {
  const fake = fakeTransport({ [`GET ${SM}`]: json({ ...STORED, effective: undefined }) });
  expect(await readSmtp(fake.transport.gateway, 'acme')).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});
