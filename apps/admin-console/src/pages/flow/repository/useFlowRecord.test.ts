import { expect, it } from 'vitest';
import { flowSaves } from '#/pages/flow/repository/useFlowRecord';
import { fakeTransport } from '#/testing/fakeTransport';
import { flowAnswer, FL, settingsAnswer, ST } from '#/testing/flowFixtures';

it('replaces the flow with the steps in order and no index, on the ETag given', async () => {
  const { transport, sent } = fakeTransport({ [`PUT ${FL}`]: flowAnswer() });
  const result = await flowSaves('acme').steps(transport.gateway, {
    changes: {},
    values: {
      steps: [
        { authenticator: 'password', requirement: 'required' },
        { authenticator: 'otp', requirement: 'disabled' },
      ],
    },
    ifMatch: '"f1"',
  });
  expect(result.ok).toBe(true);
  expect(sent[0]).toMatchObject({
    method: 'PUT',
    ifMatch: '"f1"',
    body: [
      { authenticator: 'password', requirement: 'required' },
      { authenticator: 'otp', requirement: 'disabled' },
    ],
  });
});

it('amends otp_required alone on the settings ETag', async () => {
  const { transport, sent } = fakeTransport({ [`PATCH ${ST}`]: settingsAnswer(true, '"s2"') });
  const result = await flowSaves('acme').otp(transport.gateway, {
    changes: {},
    values: { otp_required: true },
    ifMatch: '"s1"',
  });
  expect(result).toMatchObject({ ok: true, etag: '"s2"' });
  expect(sent[0]).toMatchObject({ method: 'PATCH', ifMatch: '"s1"', body: { otp_required: true } });
});
