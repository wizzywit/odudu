import { expect, it } from 'vitest';
import { deleteSmtp, putSmtp, testSmtp } from '#/pages/email/adapter/smtp';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';
import { SM } from '#/testing/settingsFixtures';

// The bodies are those of get-smtp-put-smtp-delete-smtp-and-post-smtptest.md, verbatim:
// the relay after a PUT with a password, the refusal of a password kept for a moved
// host, the refusal of a test for a tenant with no configuration and the one for a
// host this server will not dial. The transcript shows no 200 for a test: that body is
// the documented { sent } of testSmtpResponseSchema.
const STORED = {
  configured: true,
  host: 'smtp.example.test',
  port: 587,
  from_address: 'alerts@keep.example',
  username: 'mailer',
  password_set: true,
  starttls: true,
  effective: 'tenant',
};

it('replaces the relay on the ETag it was read with, leaving the password key out to keep it', async () => {
  const fake = fakeTransport({ [`PUT ${SM}`]: json(STORED, 200, { etag: '"e2"' }) });
  const result = await putSmtp(
    fake.transport.gateway,
    'acme',
    {
      host: 'smtp.example.test',
      port: 587,
      from_address: 'alerts@keep.example',
      username: 'mailer',
      starttls: true,
    },
    '"e1"',
  );
  expect(result).toMatchObject({ ok: true, data: STORED });
  expect(fake.sent[0]).toMatchObject({ method: 'PUT', path: SM, ifMatch: '"e1"' });
  expect(fake.sent[0]?.body).not.toHaveProperty('password');
});

it('sends the password to replace it and null to clear it', async () => {
  const fake = fakeTransport({ [`PUT ${SM}`]: json(STORED) });
  const relay = { host: 'smtp.example.test', port: 587, from_address: 'a@keep.example' };
  await putSmtp(fake.transport.gateway, 'acme', { ...relay, password: 'hunter2' }, '"e1"');
  await putSmtp(fake.transport.gateway, 'acme', { ...relay, password: null }, '"e1"');
  expect(fake.sent.map((sent) => sent.body)).toMatchObject([
    { password: 'hunter2' },
    { password: null },
  ]);
});

it('reads the refusal of a password kept for a moved host as a problem that names the field', async () => {
  const fake = fakeTransport({
    [`PUT ${SM}`]: problem(400, 'about:blank', 'Bad Request', {
      detail: 'password must be sent again when host, port or username changes',
      errors: [
        { path: 'password', message: 'must be sent again when host, port or username changes' },
      ],
    }),
  });
  const result = await putSmtp(
    fake.transport.gateway,
    'acme',
    { host: 'relay.elsewhere.example', port: 587, from_address: 'alerts@keep.example' },
    '"e1"',
  );
  expect(result).toMatchObject({
    ok: false,
    kind: 'problem',
    problem: { status: 400, errors: [{ path: 'password' }] },
  });
});

it('reads a stale If-Match as the 412 it is', async () => {
  const fake = fakeTransport({
    [`PUT ${SM}`]: problem(412, 'about:blank', 'Precondition Failed', {
      detail: 'If-Match no longer matches',
    }),
  });
  const relay = { host: 'smtp.example.test', port: 587, from_address: 'a@etags.example' };
  expect(await putSmtp(fake.transport.gateway, 'acme', relay, '"0000"')).toMatchObject({
    ok: false,
    kind: 'problem',
    problem: { status: 412 },
  });
});

it('removes the relay and accepts the 204 that has no body', async () => {
  const fake = fakeTransport({ [`DELETE ${SM}`]: () => new Response(null, { status: 204 }) });
  expect((await deleteSmtp(fake.transport.gateway, 'acme')).ok).toBe(true);
  expect(fake.sent[0]).toMatchObject({ method: 'DELETE', path: SM });
});

it('sends a test to one address, and names the client it is dressed as only when one is given', async () => {
  const fake = fakeTransport({ [`POST ${SM}/test`]: json({ sent: true }) });
  expect(await testSmtp(fake.transport.gateway, 'acme', 'ops@demo.example', null)).toMatchObject({
    ok: true,
    data: { sent: true },
  });
  await testSmtp(fake.transport.gateway, 'acme', 'ops@demo.example', 'c-bill');
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    { to: 'ops@demo.example' },
    { to: 'ops@demo.example', client_id: 'c-bill' },
  ]);
});

it('reads a refused test as a problem with the server’s own detail', async () => {
  const fake = fakeTransport({
    [`POST ${SM}/test`]: problem(400, 'about:blank', 'Bad Request', {
      detail: 'this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address',
    }),
  });
  expect(await testSmtp(fake.transport.gateway, 'acme', 'ops@demo.example', null)).toMatchObject({
    ok: false,
    kind: 'problem',
    problem: {
      status: 400,
      detail: 'this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address',
    },
  });
});
