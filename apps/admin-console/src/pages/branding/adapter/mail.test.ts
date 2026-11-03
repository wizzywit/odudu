import { expect, it } from 'vitest';
import tenantBranding from '#/pages/branding/adapter/fixtures/mail-branding.json';
import clientBranding from '#/pages/branding/adapter/fixtures/mail-branding-client.json';
import { mailPreviewSource, readMailBranding } from '#/pages/branding/adapter/mail';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

// The two bodies are the answers of `GET /mail/branding` and of a client's,
// copied from the transcript of that route. The preview answers an HTML
// document the frame fetches itself, so only its address is built here.
const ML = `${ACME_ADMIN}/mail/branding`;
const CLIENT_ML = `${ACME_ADMIN}/clients/c-portal/mail/branding`;

it('reads the tenant’s own mail branding from the tenant’s path', async () => {
  const fake = fakeTransport({ [`GET ${ML}`]: json(tenantBranding) });
  const result = await readMailBranding(fake.transport.gateway, 'acme', '');
  expect(fake.sent.map((request) => `${request.method} ${request.path}`)).toEqual([`GET ${ML}`]);
  expect(result).toMatchObject({ ok: true, data: tenantBranding });
  if (!result.ok) return;
  expect(result.data.light.source).toBe('tenant');
  expect(result.data.logo?.width).toBe(96);
});

it('reads a client’s from the client’s path, where its palette says it is the client’s', async () => {
  const fake = fakeTransport({ [`GET ${CLIENT_ML}`]: json(clientBranding) });
  const result = await readMailBranding(fake.transport.gateway, 'acme', 'c-portal');
  expect(fake.sent.map((request) => request.path)).toEqual([CLIENT_ML]);
  expect(result).toMatchObject({ ok: true, data: clientBranding });
  if (!result.ok) return;
  expect([result.data.light.source, result.data.dark.source]).toEqual(['client', 'tenant']);
});

it('keeps a refusal as it came, for the page to word', async () => {
  const fake = fakeTransport({ [`GET ${ML}`]: problem(403, 'about:blank', 'Forbidden') });
  const result = await readMailBranding(fake.transport.gateway, 'acme', '');
  expect(result).toMatchObject({ ok: false, kind: 'problem', problem: { status: 403 } });
});

it('does not take a body that is not the contract’s for an answer', async () => {
  const fake = fakeTransport({ [`GET ${ML}`]: json({ light: {} }) });
  const result = await readMailBranding(fake.transport.gateway, 'acme', '');
  expect(result.ok).toBe(false);
});

it('addresses the tenant’s preview with its scheme, and with a language only when one is chosen', () => {
  const base = '/console/api/admin/tenants/acme/mail/preview';
  expect(mailPreviewSource('acme', { scheme: 'dark', locale: '', client: '' })).toBe(
    `${base}?scheme=dark`,
  );
  expect(mailPreviewSource('acme', { scheme: 'light', locale: 'ar', client: '' })).toBe(
    `${base}?scheme=light&locale=ar`,
  );
});

it('addresses a client’s preview under the client, and encodes what it is given', () => {
  expect(mailPreviewSource('acme', { scheme: 'light', locale: '', client: 'c-portal' })).toBe(
    '/console/api/admin/tenants/acme/clients/c-portal/mail/preview?scheme=light',
  );
  expect(mailPreviewSource('a b', { scheme: 'light', locale: '', client: '' })).toContain(
    '/tenants/a%20b/mail/preview',
  );
});
