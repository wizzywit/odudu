import { describe, expect, it } from 'vitest';
import { deleteAsset, readAssetImage, uploadAsset } from '#/features/branding/adapter/themeAssets';
import asset from '#/features/branding/adapter/fixtures/asset.json';
import { TH } from '#/testing/brandingFixtures';
import { fakeTransport, image, json } from '#/testing/fakeTransport';

// The upload's answer is the response body of the theme transcript
// (get-theme-put-theme-and-the-theme-routes).

describe('images', () => {
  it('uploads the file as the body, under the tenant, with the slot as the query', async () => {
    const fake = fakeTransport({ [`POST ${TH}/assets`]: json(asset, 201) });
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const result = await uploadAsset(fake.transport.gateway, 'acme', 'logo', file);
    expect(result).toMatchObject({ ok: true, data: asset });
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
