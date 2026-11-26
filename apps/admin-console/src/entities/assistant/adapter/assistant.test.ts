import { expect, it } from 'vitest';
import { readAssistantStatus } from '#/entities/assistant/adapter/assistant';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const STATUS = `${ACME_ADMIN}/assistant/status`;
const ENABLED = {
  enabled: true,
  slots: { fast: 'model-f', standard: 'model-s', deep: 'model-d' },
  modes: ['ask'],
  defaultMode: 'ask',
  modelChoices: ['model-s'],
  provider: { kind: 'anthropic' },
};

it('reads the status of an assistant that is on, and one that is off', async () => {
  const on = fakeTransport({ [`GET ${STATUS}`]: json(ENABLED) });
  expect(await readAssistantStatus(on.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: ENABLED,
  });
  const off = fakeTransport({ [`GET ${STATUS}`]: json({ enabled: false }) });
  expect(await readAssistantStatus(off.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: { enabled: false },
  });
});

it('refuses a status that does not follow the contract', async () => {
  const fake = fakeTransport({ [`GET ${STATUS}`]: json({ enabled: true }) });
  expect((await readAssistantStatus(fake.transport.gateway, 'acme')).ok).toBe(false);
});
