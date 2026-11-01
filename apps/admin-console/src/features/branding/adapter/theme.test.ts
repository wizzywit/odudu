import { describe, expect, it } from 'vitest';
import {
  deleteAsset,
  discardThemeDraft,
  previewSource,
  publishTheme,
  putTheme,
  readAssetImage,
  readPreviewInfo,
  readStylesheetHooks,
  readTheme,
  readVersions,
  resetTheme,
  restoreVersion,
  uploadAsset,
} from '#/features/branding/adapter/theme';
import { NO_DRAFT_TAG } from '#/features/branding/service';
import {
  draftedView,
  EMPTY,
  PI,
  previewInfo,
  SH,
  STYLESHEET_HOOKS,
  TH,
  themeView,
} from '#/testing/brandingFixtures';
import { fakeTransport, image, json, problem } from '#/testing/fakeTransport';

const CLIENT_TH = '/console/api/admin/tenants/acme/clients/c1/theme';

describe('reading', () => {
  it('holds a theme with no draft under a tag of its own, since the server sends none', async () => {
    const fake = fakeTransport({ [`GET ${TH}`]: json(themeView()) });
    expect(await readTheme(fake.transport.gateway, 'acme', { kind: 'tenant' })).toMatchObject({
      ok: true,
      etag: NO_DRAFT_TAG,
    });
  });

  it('keeps the draft’s own tag as it was sent', async () => {
    const fake = fakeTransport({ [`GET ${TH}`]: json(draftedView(), 200, { etag: '"d1"' }) });
    expect(await readTheme(fake.transport.gateway, 'acme', { kind: 'tenant' })).toMatchObject({
      etag: '"d1"',
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
    const fake = fakeTransport({ [`GET ${TH}/versions`]: json({ items: [] }) });
    expect(await readVersions(fake.transport.gateway, 'acme', { kind: 'tenant' })).toMatchObject({
      ok: true,
      data: { items: [] },
    });
  });
});

describe('writing', () => {
  it('puts the draft with its tag, and with no If-Match for the first one', async () => {
    const fake = fakeTransport({ [`PUT ${TH}`]: json(draftedView(), 200, { etag: '"d2"' }) });
    const gateway = fake.transport.gateway;
    await putTheme(gateway, 'acme', { kind: 'tenant' }, EMPTY, '"d1"');
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

  it('publishes on the draft’s tag', async () => {
    const fake = fakeTransport({
      [`POST ${TH}/publish`]: json({ ...draftedView(), warnings: [] }),
    });
    await publishTheme(fake.transport.gateway, 'acme', { kind: 'tenant' }, '"d1"');
    expect(fake.sent[0]).toMatchObject({ method: 'POST', ifMatch: '"d1"' });
  });

  it('resets with a DELETE and restores with a POST on the version', async () => {
    const fake = fakeTransport({
      [`DELETE ${TH}`]: json(themeView()),
      [`POST ${TH}/versions/v1/restore`]: json(draftedView()),
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

describe('images', () => {
  const ASSET = {
    id: 'a',
    sha256: 's',
    mime: 'image/png',
    width: 1,
    height: 1,
    bytes: 1,
    kind: 'logo',
  };

  it('uploads the file as the body, under the tenant, with the slot as the query', async () => {
    const fake = fakeTransport({ [`POST ${TH}/assets`]: json(ASSET, 201) });
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const result = await uploadAsset(fake.transport.gateway, 'acme', 'logo', file);
    expect(result).toMatchObject({ ok: true, data: { id: 'a' } });
    expect(fake.sent[0]?.search.get('kind')).toBe('logo');
  });

  it('deletes an image by id', async () => {
    const fake = fakeTransport({
      [`DELETE ${TH}/assets/a%2F1`]: () => new Response(null, { status: 204 }),
    });
    expect(await deleteAsset(fake.transport.gateway, 'acme', 'a/1')).toMatchObject({ ok: true });
  });

  it('reads an image’s content as a data address, whether or not any theme names it', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0xff, 0x00]);
    const fake = fakeTransport({ [`GET ${TH}/assets/a%2F1/content`]: image(bytes) });
    expect(await readAssetImage(fake.transport.gateway, 'acme', 'a/1')).toEqual({
      ok: true,
      status: 200,
      data: 'data:image/png;base64,iVD/AA==',
      etag: null,
      next: null,
    });
  });

  it('refuses an answer that is not a PNG, a JPEG or a WebP, and passes a refusal on', async () => {
    const odd = fakeTransport({
      [`GET ${TH}/assets/a/content`]: image(new Uint8Array([1]), 'image/svg+xml'),
    });
    expect(await readAssetImage(odd.transport.gateway, 'acme', 'a')).toMatchObject({
      ok: false,
      kind: 'schema',
    });
    const missing = fakeTransport({});
    expect(await readAssetImage(missing.transport.gateway, 'acme', 'a')).toMatchObject({
      ok: false,
      kind: 'problem',
      problem: { status: 404 },
    });
  });
});

describe('the preview address', () => {
  it('is the console’s own route to the admin API, with the page and scheme asked for', () => {
    expect(previewSource('acme', { kind: 'tenant' }, { kind: 'consent', scheme: 'dark' })).toBe(
      '/console/api/admin/tenants/acme/theme/preview?kind=consent&scheme=dark',
    );
  });

  it('is under the client for a client’s theme, and encodes the tenant as one segment', () => {
    expect(
      previewSource('a b', { kind: 'client', id: 'c1' }, { kind: 'sign-in', scheme: 'light' }),
    ).toBe('/console/api/admin/tenants/a%20b/clients/c1/theme/preview?kind=sign-in&scheme=light');
  });
});

describe('reading the selectors a stylesheet may use', () => {
  it('asks the tenant for the one list, whichever scope is being edited', async () => {
    const fake = fakeTransport({ [`GET ${SH}`]: json(STYLESHEET_HOOKS) });
    const result = await readStylesheetHooks(fake.transport.gateway, 'acme');
    expect(result).toMatchObject({ ok: true, data: { version: 1 } });
    expect(fake.sent.map((s) => s.path)).toEqual([SH]);
  });

  it('refuses an answer that is not one', async () => {
    const fake = fakeTransport({ [`GET ${SH}`]: json({ classes: 'logo' }) });
    expect(await readStylesheetHooks(fake.transport.gateway, 'acme')).toMatchObject({
      ok: false,
      kind: 'schema',
    });
  });
});

describe('reading what a preview shows', () => {
  const choice = { kind: 'consent', scheme: 'dark' } as const;

  it('asks for the page and scheme the frame is given, beside the tenant’s theme', async () => {
    const fake = fakeTransport({ [`GET ${PI}`]: json(previewInfo({ kind: 'consent' })) });
    const result = await readPreviewInfo(
      fake.transport.gateway,
      'acme',
      { kind: 'tenant' },
      choice,
    );
    expect(result).toMatchObject({ ok: true, data: { kind: 'consent' } });
    expect(Object.fromEntries(fake.sent[0]?.search ?? [])).toEqual({
      kind: 'consent',
      scheme: 'dark',
    });
  });

  it('asks beside the client for a client’s preview', async () => {
    const fake = fakeTransport({ [`GET ${CLIENT_TH}/preview/info`]: json(previewInfo()) });
    const result = await readPreviewInfo(
      fake.transport.gateway,
      'acme',
      { kind: 'client', id: 'c1' },
      choice,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses an answer that is not one', async () => {
    const fake = fakeTransport({ [`GET ${PI}`]: json({ shown: 'nowhere' }) });
    expect(
      await readPreviewInfo(fake.transport.gateway, 'acme', { kind: 'tenant' }, choice),
    ).toMatchObject({ ok: false, kind: 'schema' });
  });
});
