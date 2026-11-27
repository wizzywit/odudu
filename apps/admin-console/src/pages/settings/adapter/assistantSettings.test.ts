import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import {
  putAssistantSettings,
  readAssistantSettings,
} from '#/pages/settings/adapter/assistantSettings';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';

const PATH = '/console/api/admin/tenants/acme/assistant/settings';

it('reads the settings with the ETag that stands for them', async () => {
  const fake = fakeTransport({
    [`GET ${PATH}`]: json(ASSISTANT_SETTING_DEFAULTS, 200, { etag: '"e1"' }),
  });
  expect(await readAssistantSettings(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: ASSISTANT_SETTING_DEFAULTS,
    etag: '"e1"',
  });
});

it('reads a deployment with no assistant as a 404 problem, not a failure of the console', async () => {
  const fake = fakeTransport({
    [`GET ${PATH}`]: problem(404, 'about:blank', 'Not Found'),
  });
  expect(await readAssistantSettings(fake.transport.gateway, 'acme')).toMatchObject({
    ok: false,
    kind: 'problem',
    problem: { status: 404 },
  });
});

it('refuses an answer that leaves a setting out', async () => {
  const rest = Object.fromEntries(
    Object.entries(ASSISTANT_SETTING_DEFAULTS).filter(
      ([name]) => name !== 'assistant_max_concurrent',
    ),
  );
  const fake = fakeTransport({ [`GET ${PATH}`]: json(rest, 200, { etag: '"e1"' }) });
  expect(await readAssistantSettings(fake.transport.gateway, 'acme')).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});

it('replaces the document on the ETag it was read with', async () => {
  const next = { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false };
  const fake = fakeTransport({ [`PUT ${PATH}`]: json(next, 200, { etag: '"e2"' }) });
  expect(await putAssistantSettings(fake.transport.gateway, 'acme', next, '"e1"')).toMatchObject({
    ok: true,
    data: next,
    etag: '"e2"',
  });
  expect(fake.sent[0]).toMatchObject({ method: 'PUT', path: PATH, ifMatch: '"e1"', body: next });
});
