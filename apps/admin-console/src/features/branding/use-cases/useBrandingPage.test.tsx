import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useBrandingPage } from '#/features/branding/use-cases/useBrandingPage';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import {
  brandingRoutes,
  draftedView,
  MC,
  PI,
  SH,
  themeAnswer,
  TH,
} from '#/testing/brandingFixtures';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { settingsAnswer, ST } from '#/testing/settingsFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const address = vi.hoisted(() => ({ search: '', go: vi.fn<(params: URLSearchParams) => void>() }));

vi.mock('#/shared/repository/useUrlSearch', () => ({
  useUrlSearch: () => ({
    params: new URLSearchParams(address.search),
    go: address.go,
    drop: vi.fn(),
  }),
}));

afterEach(() => {
  address.search = '';
  address.go.mockClear();
  resetConsole();
});

function page(search: string) {
  address.search = search;
  const harness = hookHarness(
    brandingRoutes(themeAnswer(draftedView(), '"d1"'), {
      [`GET ${ST}`]: settingsAnswer({ supported_locales: ['en'] }),
      [`GET ${ACME_ADMIN}/clients`]: json({ items: [] }),
    }),
  );
  const view = renderHook(() => useBrandingPage('acme'), { wrapper: harness.wrapper });
  return { ...view, sent: harness.sent };
}

const paths = (sent: readonly { path: string }[]) => sent.map((request) => request.path);

it('opens on the Theme tab, and on it again for a tab the area does not have', () => {
  expect(page('').result.current.tab).toBe('theme');
  expect(page('tab=bogus').result.current.tab).toBe('theme');
  expect(page('tab=languages').result.current.tab).toBe('languages');
});

it('moves to a tab the area offers, and ignores any other name', () => {
  const { result } = page('');
  act(() => {
    result.current.selectTab('mail');
  });
  expect(address.go).toHaveBeenCalledTimes(1);
  expect(address.go.mock.calls[0]?.[0].get('tab')).toBe('mail');
  act(() => {
    result.current.selectTab('bogus');
  });
  expect(address.go).toHaveBeenCalledTimes(1);
});

it('frames the preview on the Theme and Pages tabs only', async () => {
  const theme = page('tab=theme');
  await waitFor(() => {
    expect(paths(theme.sent)).toContain(PI);
  });
  const mail = page('tab=mail');
  await waitFor(() => {
    expect(mail.result.current.branding.view).toBeDefined();
  });
  expect(paths(mail.sent)).not.toContain(PI);
});

it('starts the reads the tab shown needs beside the theme’s own', async () => {
  const theme = page('tab=theme');
  await waitFor(() => {
    expect(paths(theme.sent)).toContain(SH);
  });
  expect(paths(theme.sent)).toContain(`${TH}/versions`);
  expect(paths(theme.sent)).not.toContain(MC);
  const languages = page('tab=languages');
  await waitFor(() => {
    expect(paths(languages.sent)).toContain(MC);
  });
  expect(paths(languages.sent)).toContain(ST);
  expect(paths(languages.sent)).not.toContain(SH);
});

it('dots the tabs whose sections hold unsaved edits, the languages from the settings record', () => {
  const { result } = page('');
  expect([...result.current.dirty]).toEqual([]);
  act(() => {
    useUnsavedGuard.getState().setDirty('acme/theme#colours', 'Colours and font');
    useUnsavedGuard.getState().setDirty('acme/settings#languages', 'Languages');
  });
  expect([...result.current.dirty].sort()).toEqual(['languages', 'theme']);
});
