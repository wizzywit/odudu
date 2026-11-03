import { describe, expect, it } from 'vitest';
import {
  previewSource,
  readPreviewInfo,
  readStylesheetHooks,
} from '#/features/branding/adapter/themePreview';
import hooks from '#/features/branding/adapter/fixtures/stylesheet-hooks.json';
import info from '#/features/branding/adapter/fixtures/preview-info.json';
import { PI, SH } from '#/testing/brandingFixtures';
import { fakeTransport, json } from '#/testing/fakeTransport';

// The preview's answer is the response body of the theme transcript
// (get-theme-put-theme-and-the-theme-routes). That page prints no body for the
// stylesheet hooks, only the version, the pseudo-class and pseudo-element
// lists and the first names of the others, so the fixture holds those names
// and, for `elements`, the two the reference page gives as examples.

const CLIENT_TH = '/console/api/admin/tenants/acme/clients/c1/theme';

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
    const fake = fakeTransport({ [`GET ${SH}`]: json(hooks) });
    const result = await readStylesheetHooks(fake.transport.gateway, 'acme');
    expect(result).toMatchObject({ ok: true, data: hooks });
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
    const fake = fakeTransport({ [`GET ${PI}`]: json(info) });
    const result = await readPreviewInfo(
      fake.transport.gateway,
      'acme',
      { kind: 'tenant' },
      choice,
    );
    expect(result).toMatchObject({ ok: true, data: info });
    expect(Object.fromEntries(fake.sent[0]?.search ?? [])).toEqual({
      kind: 'consent',
      scheme: 'dark',
    });
  });

  it('asks beside the client for a client’s preview', async () => {
    const fake = fakeTransport({ [`GET ${CLIENT_TH}/preview/info`]: json(info) });
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
