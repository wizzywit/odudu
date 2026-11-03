import { type ThemeView } from '#/features/branding-editor';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { sourceText } from '#/pages/branding/services/mailInheritance';
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

function lightPalette(current: ReturnType<typeof useMailTab>) {
  const { read } = current.inherits;
  if (read.status !== 'ready') throw new Error('the mail was not read');
  const [light] = read.data.palettes;
  if (light === undefined) throw new Error('no light palette');
  return light;
}

function panelColour(current: ReturnType<typeof useMailTab>): string | undefined {
  return lightPalette(current).rows.find((row) => row.role === 'panel')?.colour;
}

function lightSource(current: ReturnType<typeof useMailTab>): string | undefined {
  const { read } = current.inherits;
  return read.status === 'ready' ? read.data.palettes[0]?.source : undefined;
}

async function loaded(result: { current: ReturnType<typeof useMailTab> }) {
  await waitFor(() => {
    expect(result.current.clientChoice.picker.options).toHaveLength(CLIENTS.length);
    expect(result.current.inherits.read.status).toBe('ready');
  });
}

it('previews the tenant’s own mail in the light scheme and its default language', async () => {
  const { result } = mail();
  expect(result.current.preview.view.scheme.value).toBe('light');
  expect(result.current.preview.view.locale.value).toBe('');
  expect(result.current.frame.src).toBe(`${TENANT_PREVIEW}?scheme=light`);
  expect(result.current.clientChoice.view.selected).toEqual([]);
  await loaded(result);
});

it('follows the chosen scheme and language in the preview address', async () => {
  const { result } = mail();
  await loaded(result);
  act(() => {
    result.current.preview.chooseScheme('dark');
    result.current.preview.chooseLocale('ar');
  });
  expect(result.current.frame.src).toBe(`${TENANT_PREVIEW}?scheme=dark&locale=ar`);
});

it('changes the preview address and the palette rows when a client is chosen', async () => {
  const { result, sent } = mail();
  await loaded(result);
  expect(panelColour(result.current)).toBe('#fafafa');
  const keyBefore = result.current.frame.key;
  act(() => {
    result.current.clientChoice.choose([BILLING.id]);
  });
  expect(result.current.clientChoice.view.selected).toEqual(['c-bill']);
  expect(result.current.frame.src).toBe(
    '/console/api/admin/tenants/acme/clients/c-bill/mail/preview?scheme=light',
  );
  expect(result.current.frame.key).not.toBe(keyBefore);
  await waitFor(() => {
    expect(sent.map((request) => request.path)).toContain(CLIENT_MAIL);
  });
  await waitFor(() => {
    expect(lightSource(result.current)).toBe(sourceText('client'));
  });
  expect(panelColour(result.current)).toBe('#f0f8ff');
});

it('goes back to the tenant’s own, and to it for an id the picker does not hold', async () => {
  const { result } = mail();
  await loaded(result);
  act(() => {
    result.current.clientChoice.choose([BILLING.id]);
  });
  act(() => {
    result.current.clientChoice.showTenantOwn();
  });
  expect(result.current.clientChoice.view.selected).toEqual([]);
  expect(result.current.frame.src).toBe(`${TENANT_PREVIEW}?scheme=light`);
  act(() => {
    result.current.clientChoice.choose(['nobody']);
  });
  expect(result.current.clientChoice.view.selected).toEqual([]);
});

it('is loading until the frame says it has loaded what it was asked for', async () => {
  const { result } = mail();
  await loaded(result);
  expect(result.current.frame.loading).toBe(true);
  act(() => {
    result.current.frame.onLoaded();
  });
  expect(result.current.frame.loading).toBe(false);
  act(() => {
    result.current.preview.chooseScheme('dark');
  });
  expect(result.current.frame.loading).toBe(true);
});

it('reads nothing while the tab is not the one shown', async () => {
  const { sent } = mail(false);
  await act(() => Promise.resolve());
  expect(sent).toEqual([]);
});
