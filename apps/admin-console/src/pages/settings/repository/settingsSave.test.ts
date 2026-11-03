import { expect, it } from 'vitest';
import { settingsSave } from '#/pages/settings/repository/settingsSave';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const ST = `${ACME_ADMIN}/settings`;

it('amends only what changed, on the ETag the settings were read with', async () => {
  const { transport, sent } = fakeTransport({
    [`PATCH ${ST}`]: json({ verify_email: true }, 200, { etag: '"s2"' }),
  });
  const result = await settingsSave('acme')(transport.gateway, {
    changes: { verify_email: true, audit_event_types: ['admin_mutation', 'token'] },
    values: { verify_email: true, login_with_email: false },
    ifMatch: '"s1"',
  });
  expect(result).toMatchObject({ ok: true, etag: '"s2"' });
  expect(sent[0]).toMatchObject({
    method: 'PATCH',
    ifMatch: '"s1"',
    body: { verify_email: true, audit_event_types: ['admin_mutation', 'token'] },
  });
});

it('sends a number that was cleared as nothing at all', async () => {
  const { transport, sent } = fakeTransport({ [`PATCH ${ST}`]: json({}, 200, { etag: '"s2"' }) });
  await settingsSave('acme')(transport.gateway, {
    changes: { password_min_length: Number.NaN },
    values: { password_min_length: Number.NaN },
    ifMatch: '"s1"',
  });
  expect(sent[0]?.body).toEqual({});
});

// The request and the answer of the PATCH in `get-settings-and-patch-settings.md`.
it('answers the whole object as it now reads, with the fresh ETag of the transcript', async () => {
  const etag = '"1de2b99ffd716e07c8e28fec21cb5c7562f2bc13b2ca5eec9e506acf774885b8"';
  const { transport, sent } = fakeTransport({
    [`PATCH ${ST}`]: json(
      { display_name: 'Settings Demo', verify_email: true, password_min_length: 14 },
      200,
      { etag },
    ),
  });
  const result = await settingsSave('acme')(transport.gateway, {
    changes: { verify_email: true, password_min_length: 14 },
    values: { verify_email: true, password_min_length: 14 },
    ifMatch: '"fd9972c6ca4296014c10131d8baea2b85aae944d7eae3fd59a95fd12a8891093"',
  });
  expect(sent[0]?.body).toEqual({ verify_email: true, password_min_length: 14 });
  expect(result).toMatchObject({
    ok: true,
    etag,
    data: { verify_email: true, password_min_length: 14 },
  });
});
