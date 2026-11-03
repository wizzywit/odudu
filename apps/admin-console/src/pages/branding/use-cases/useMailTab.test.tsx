import { type ThemeView } from '#/features/branding-editor';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { paletteRows } from '#/pages/branding/services/mailInheritance';
import { useMailTab } from '#/pages/branding/use-cases/useMailTab';
import { draftedView, mailBranding, ML } from '#/testing/brandingFixtures';
import { BILLING, C, CLIENTS } from '#/testing/clientsFixtures';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';

const VIEW = draftedView() as ThemeView;
const CLIENT_MAIL = `${C}/c-bill/mail/branding`;
const TENANT_PREVIEW = '/console/api/admin/tenants/acme/mail/preview';

function mail(asked = true, view: ThemeView | undefined = VIEW) {
  const own = mailBranding();
  const billing = mailBranding({
    light: { source: 'client', colours: { ...own.light.colours, panel: '#f0f8ff' } },
  });
  const harness = hookHarness({
    [`GET ${ML}`]: json(own),
    [`GET ${CLIENT_MAIL}`]: json(billing),
    [`GET ${C}`]: json({ items: CLIENTS }),
  });
  const rendered = renderHook(() => useMailTab('acme', view, asked), { wrapper: harness.wrapper });
  return { ...rendered, sent: harness.sent };
}

async function loaded(result: { current: ReturnType<typeof useMailTab> }) {
  await waitFor(() => {
    expect(result.current.picker.options).toHaveLength(CLIENTS.length);
    expect(result.current.branding.status).toBe('ready');
  });
}

it('previews the tenant’s own mail in the light scheme and its default language', async () => {
  const { result } = mail();
  expect(result.current.choice).toEqual({ scheme: 'light', locale: '', client: '' });
  expect(result.current.src).toBe(`${TENANT_PREVIEW}?scheme=light`);
  expect(result.current.client).toBeNull();
  await loaded(result);
});

it('follows the chosen scheme and language in the preview address', async () => {
  const { result } = mail();
  await loaded(result);
  act(() => {
    result.current.setScheme('dark');
    result.current.setLocale('fr');
  });
  expect(result.current.src).toBe(`${TENANT_PREVIEW}?scheme=dark&locale=fr`);
});

it('changes the preview address and the palette rows when a client is chosen', async () => {
  const { result, sent } = mail();
  await loaded(result);
  const own = result.current.branding;
  if (own.status !== 'ready') throw new Error('the tenant’s mail was not read');
  expect(paletteRows(own.data.light.colours).find((row) => row.role === 'panel')?.colour).toBe(
    '#fafafa',
  );
  const keyBefore = result.current.frameKey;
  act(() => {
    result.current.chooseClient([BILLING.id]);
  });
  expect(result.current.client).toEqual({ id: 'c-bill', name: 'Billing' });
  expect(result.current.src).toBe(
    '/console/api/admin/tenants/acme/clients/c-bill/mail/preview?scheme=light',
  );
  expect(result.current.frameKey).not.toBe(keyBefore);
  await waitFor(() => {
    expect(sent.map((request) => request.path)).toContain(CLIENT_MAIL);
  });
  await waitFor(() => {
    const read = result.current.branding;
    expect(read.status === 'ready' && read.data.light.source).toBe('client');
  });
  const chosen = result.current.branding;
  if (chosen.status !== 'ready') throw new Error('the client’s mail was not read');
  expect(paletteRows(chosen.data.light.colours).find((row) => row.role === 'panel')?.colour).toBe(
    '#f0f8ff',
  );
});

it('goes back to the tenant’s own, and to it for an id the picker does not hold', async () => {
  const { result } = mail();
  await loaded(result);
  act(() => {
    result.current.chooseClient([BILLING.id]);
  });
  act(() => {
    result.current.showTenantOwn();
  });
  expect(result.current.client).toBeNull();
  expect(result.current.src).toBe(`${TENANT_PREVIEW}?scheme=light`);
  act(() => {
    result.current.chooseClient(['nobody']);
  });
  expect(result.current.client).toBeNull();
});

it('is loading until the frame says it has loaded what it was asked for', async () => {
  const { result } = mail();
  await loaded(result);
  expect(result.current.loading).toBe(true);
  act(() => {
    result.current.onLoaded();
  });
  expect(result.current.loading).toBe(false);
  act(() => {
    result.current.setScheme('dark');
  });
  expect(result.current.loading).toBe(true);
});

it('reads nothing while the tab is not the one shown', async () => {
  const { sent } = mail(false);
  await act(() => Promise.resolve());
  expect(sent).toEqual([]);
});
