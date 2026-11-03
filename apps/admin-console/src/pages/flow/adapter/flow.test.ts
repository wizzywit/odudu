import { expect, it } from 'vitest';
import { readFlow, replaceFlow } from '#/pages/flow/adapter/flow';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';
import { FL } from '#/testing/flowFixtures';

// The bodies and tags are those of get-flowexecutions-and-put-flowexecutions.md,
// verbatim: the flow a tenant starts with, the PUT that replaced it, the 412
// of the stale tag and the 400 of the empty list.
const START_ETAG = '"2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"';
const REPLACED_ETAG = '"c46d3990450c6fdda560192fb31bb5c43d939d3ec27ba6861173ef4c2992e589"';

const STARTED = {
  items: [
    { index: 0, authenticator: 'passkey', requirement: 'alternative' },
    { index: 1, authenticator: 'password', requirement: 'alternative' },
    { index: 2, authenticator: 'otp', requirement: 'conditional' },
    { index: 3, authenticator: 'recovery-code', requirement: 'conditional' },
  ],
  available: ['password', 'passkey', 'otp', 'recovery-code'],
};

const REPLACED = {
  items: [
    { index: 0, authenticator: 'password', requirement: 'required' },
    { index: 1, authenticator: 'otp', requirement: 'conditional' },
    { index: 2, authenticator: 'passkey', requirement: 'disabled' },
  ],
  available: ['password', 'passkey', 'otp', 'recovery-code'],
};

const STEPS = [
  { authenticator: 'password', requirement: 'required' },
  { authenticator: 'otp', requirement: 'conditional' },
  { authenticator: 'passkey', requirement: 'disabled' },
] as const;

it('reads the whole flow with its ETag from flow/executions', async () => {
  const fake = fakeTransport({ [`GET ${FL}`]: json(STARTED, 200, { etag: START_ETAG }) });
  const result = await readFlow(fake.transport.gateway, 'acme');
  expect(result).toMatchObject({ ok: true, etag: START_ETAG, data: STARTED });
  expect(fake.sent[0]).toMatchObject({ method: 'GET', path: FL });
});

it('replaces the flow with the steps in order and no index, on the ETag it was read with', async () => {
  const fake = fakeTransport({ [`PUT ${FL}`]: json(REPLACED, 200, { etag: REPLACED_ETAG }) });
  const result = await replaceFlow(fake.transport.gateway, 'acme', [...STEPS], START_ETAG);
  expect(result).toMatchObject({ ok: true, etag: REPLACED_ETAG, data: REPLACED });
  expect(fake.sent[0]).toMatchObject({ method: 'PUT', ifMatch: START_ETAG, body: STEPS });
});

it('reads a stale tag as the 412 problem it is', async () => {
  const fake = fakeTransport({
    [`PUT ${FL}`]: problem(412, 'about:blank', 'Precondition Failed', {
      detail: 'If-Match no longer matches',
    }),
  });
  expect(
    await replaceFlow(
      fake.transport.gateway,
      'acme',
      [{ authenticator: 'password', requirement: 'required' }],
      START_ETAG,
    ),
  ).toMatchObject({ ok: false, kind: 'problem', problem: { status: 412 } });
});

it('keeps the type of a 400 so the console can word it, here the empty flow', async () => {
  const fake = fakeTransport({
    [`PUT ${FL}`]: problem(400, 'about:blank#flow-empty', 'Bad Request', {
      detail: 'a flow needs at least one step; a tenant with no flow cannot be logged into',
    }),
  });
  expect(await replaceFlow(fake.transport.gateway, 'acme', [], START_ETAG)).toMatchObject({
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank#flow-empty', status: 400 },
  });
});

it('keeps the path of the step a 400 names, here the unknown authenticator', async () => {
  const fake = fakeTransport({
    [`PUT ${FL}`]: problem(400, 'about:blank#flow-unknown-authenticator', 'Bad Request', {
      detail: 'unknown authenticator "sms"; expected one of password, passkey, otp, recovery-code',
      errors: [{ path: '[0].authenticator', message: 'is not a registered authenticator' }],
    }),
  });
  expect(
    await replaceFlow(
      fake.transport.gateway,
      'acme',
      [{ authenticator: 'sms', requirement: 'required' }],
      START_ETAG,
    ),
  ).toMatchObject({
    ok: false,
    problem: { errors: [{ path: '[0].authenticator' }] },
  });
});

it('refuses a flow answered without what the registry offers', async () => {
  const fake = fakeTransport({ [`GET ${FL}`]: json({ items: STARTED.items }) });
  expect(await readFlow(fake.transport.gateway, 'acme')).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});

it('reads a missing permission as a problem, not as an empty flow', async () => {
  const fake = fakeTransport({ [`GET ${FL}`]: problem(403, 'about:blank', 'Forbidden') });
  expect(await readFlow(fake.transport.gateway, 'acme')).toMatchObject({
    ok: false,
    problem: { status: 403 },
  });
});
