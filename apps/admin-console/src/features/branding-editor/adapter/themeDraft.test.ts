import { describe, expect, it } from 'vitest';
import {
  discardThemeDraft,
  publishTheme,
  putTheme,
  readTheme,
  readVersions,
  resetTheme,
  restoreVersion,
} from '#/features/branding-editor/adapter/themeDraft';
import published from '#/features/branding-editor/adapter/fixtures/published.json';
import theme from '#/features/branding-editor/adapter/fixtures/theme.json';
import versions from '#/features/branding-editor/adapter/fixtures/versions.json';
import { NO_DRAFT_TAG } from '#/features/branding-editor/services/themeScope';
import { EMPTY, TH, themeView } from '#/testing/brandingFixtures';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';

// The answers are the response bodies of the theme transcript
// (get-theme-put-theme-and-the-theme-routes), read back as the domain object
// the adapter returns.

const CLIENT_TH = '/console/api/admin/tenants/acme/clients/c1/theme';
const DRAFT_TAG = '"ac0e6a06fac52ca3153ec081fe9c8d49cd108fa7389ce95e6005fc1043c22d90"';

describe('reading', () => {
  it('holds a theme with no draft under a tag of its own, since the server sends none', async () => {
    const fake = fakeTransport({ [`GET ${TH}`]: json(themeView()) });
    expect(await readTheme(fake.transport.gateway, 'acme', { kind: 'tenant' })).toMatchObject({
      ok: true,
      etag: NO_DRAFT_TAG,
    });
  });

  it('reads the draft and the layer of each piece, with the draft’s own tag as it was sent', async () => {
    const fake = fakeTransport({ [`GET ${TH}`]: json(theme, 200, { etag: DRAFT_TAG }) });
    expect(await readTheme(fake.transport.gateway, 'acme', { kind: 'tenant' })).toMatchObject({
      ok: true,
      data: theme,
      etag: DRAFT_TAG,
    });
  });

  it('reads a client’s theme beside the client', async () => {
    const fake = fakeTransport({ [`GET ${CLIENT_TH}`]: json(themeView({ scope: 'client' })) });
    const result = await readTheme(fake.transport.gateway, 'acme', { kind: 'client', id: 'c1' });
    expect(result).toMatchObject({ ok: true, data: { scope: 'client' } });
  });

  it('refuses an answer that is not a theme', async () => {
    const fake = fakeTransport({ [`GET ${TH}`]: json({ nothing: true }) });
    expect(await readTheme(fake.transport.gateway, 'acme', { kind: 'tenant' })).toMatchObject({
      ok: false,
      kind: 'schema',
    });
  });

  it('reads the versions', async () => {
    const fake = fakeTransport({ [`GET ${TH}/versions`]: json(versions) });
    expect(await readVersions(fake.transport.gateway, 'acme', { kind: 'tenant' })).toMatchObject({
      ok: true,
      data: versions,
    });
  });
});

describe('writing', () => {
  it('puts the draft with its tag, and with no If-Match for the first one', async () => {
    const fake = fakeTransport({ [`PUT ${TH}`]: json(theme, 200, { etag: DRAFT_TAG }) });
    const gateway = fake.transport.gateway;
    expect(await putTheme(gateway, 'acme', { kind: 'tenant' }, EMPTY, '"d1"')).toMatchObject({
      ok: true,
      data: theme,
    });
    await putTheme(gateway, 'acme', { kind: 'tenant' }, EMPTY, NO_DRAFT_TAG);
    expect(fake.sent.map((sent) => sent.ifMatch)).toEqual(['"d1"', null]);
    expect(fake.sent[0]?.body).toEqual(EMPTY);
  });

  it('answers a 428 to a first save as stale, since a draft appeared meanwhile', async () => {
    const fake = fakeTransport({
      [`PUT ${TH}`]: problem(428, 'about:blank', 'Precondition Required'),
    });
    const result = await putTheme(
      fake.transport.gateway,
      'acme',
      { kind: 'tenant' },
      EMPTY,
      NO_DRAFT_TAG,
    );
    expect(result).toMatchObject({ ok: false, kind: 'problem', problem: { status: 412 } });
  });

  it('publishes on the draft’s tag, and answers the published theme with its warnings', async () => {
    const fake = fakeTransport({ [`POST ${TH}/publish`]: json(published) });
    const result = await publishTheme(fake.transport.gateway, 'acme', { kind: 'tenant' }, '"d1"');
    expect(fake.sent[0]).toMatchObject({ method: 'POST', ifMatch: '"d1"' });
    expect(result).toMatchObject({ ok: true, data: published });
  });

  it('resets with a DELETE and restores with a POST on the version', async () => {
    const fake = fakeTransport({
      [`DELETE ${TH}`]: json(themeView()),
      [`POST ${TH}/versions/v1/restore`]: json(theme),
    });
    const gateway = fake.transport.gateway;
    expect(await resetTheme(gateway, 'acme', { kind: 'tenant' })).toMatchObject({ ok: true });
    expect(await restoreVersion(gateway, 'acme', { kind: 'tenant' }, 'v1')).toMatchObject({
      ok: true,
    });
    expect(fake.sent.map((sent) => `${sent.method} ${sent.path}`)).toEqual([
      `DELETE ${TH}`,
      `POST ${TH}/versions/v1/restore`,
    ]);
  });

  it('discards the draft with a DELETE on the draft, on its tag, beside the tenant or the client', async () => {
    const fake = fakeTransport({
      [`DELETE ${TH}/draft`]: json(themeView()),
      [`DELETE ${CLIENT_TH}/draft`]: json(themeView({ scope: 'client' })),
    });
    const gateway = fake.transport.gateway;
    expect(await discardThemeDraft(gateway, 'acme', { kind: 'tenant' }, '"d1"')).toMatchObject({
      ok: true,
      etag: NO_DRAFT_TAG,
    });
    await discardThemeDraft(gateway, 'acme', { kind: 'client', id: 'c1' }, '"d2"');
    expect(fake.sent.map((sent) => `${sent.method} ${sent.path} ${String(sent.ifMatch)}`)).toEqual([
      `DELETE ${TH}/draft "d1"`,
      `DELETE ${CLIENT_TH}/draft "d2"`,
    ]);
  });

  it('hands a refusal on as the server made it, errors and all', async () => {
    const fake = fakeTransport({
      [`PUT ${TH}`]: problem(400, 'about:blank', 'Bad Request', {
        errors: [{ path: 'tokens.light.inkPrimary', message: 'Is not in the expected format.' }],
      }),
    });
    const result = await putTheme(fake.transport.gateway, 'acme', { kind: 'tenant' }, EMPTY, '"d"');
    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ path: 'tokens.light.inkPrimary' }] },
    });
  });
});
