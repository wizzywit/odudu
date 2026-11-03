import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { NO_OUTCOME } from '#/features/branding-editor/services/publishOutcome';
import {
  writeCapability,
  clientScope,
  NO_DRAFT_TAG,
  TENANT_SCOPE,
} from '#/features/branding-editor/services/themeScope';
import { useScopeBranding } from '#/features/branding-editor/use-cases/useScopeBranding';
import {
  brandingRoutes,
  clientBrandingRoutes,
  clientView,
  CTH,
  draftedView,
  PI,
  themeAnswer,
  themeView,
  TENANT_LAYER,
  TH,
} from '#/testing/brandingFixtures';
import { hookHarness } from '#/testing/hookHarness';

it('reads the tenant’s theme under the tenant’s key and tags it with the draft’s', async () => {
  const { wrapper, sent, queryClient } = hookHarness(
    brandingRoutes(themeAnswer(draftedView(), '"d1"')),
  );
  const { result } = renderHook(() => useScopeBranding('acme', TENANT_SCOPE, true), { wrapper });
  await waitFor(() => {
    expect(result.current.view).toBeDefined();
  });
  expect(result.current.tag).toBe('"d1"');
  expect(result.current.scope).toEqual({ kind: 'tenant' });
  expect(writeCapability(result.current.scope)).toBe('manage-tenant');
  expect([...result.current.changed]).toEqual(['theme']);
  expect(queryClient.getQueryData(['record', 'acme', 'theme'])).toBeDefined();
  expect(queryClient.getQueryData(['record', 'acme', 'clients/c-bill/theme'])).toBeUndefined();
  expect(sent.map((request) => request.path)).not.toContain(CTH);
});

it('reads a client’s theme under the client’s key, with what the tenant supplies under it', async () => {
  const view = clientView({ draft: { tokens: {}, stylesheet: null, templates: {}, assets: {} } });
  const { wrapper, sent, queryClient } = hookHarness(
    clientBrandingRoutes(themeAnswer({ ...view, changed: ['templates'] }, '"c1"')),
  );
  const { result } = renderHook(() => useScopeBranding('acme', clientScope('c-bill'), true), {
    wrapper,
  });
  await waitFor(() => {
    expect(result.current.view).toBeDefined();
  });
  expect(result.current.tag).toBe('"c1"');
  expect(result.current.scope).toEqual({ kind: 'client', id: 'c-bill', below: TENANT_LAYER });
  expect(writeCapability(result.current.scope)).toBe('manage-clients');
  expect([...result.current.changed]).toEqual(['pages']);
  expect(queryClient.getQueryData(['record', 'acme', 'clients/c-bill/theme'])).toBeDefined();
  expect(queryClient.getQueryData(['record', 'acme', 'theme'])).toBeUndefined();
  expect(sent.map((request) => request.path)).not.toContain(TH);
});

it('tags a theme with no draft with the tag that says there is none', async () => {
  const { wrapper } = hookHarness(brandingRoutes(themeAnswer(themeView())));
  const { result } = renderHook(() => useScopeBranding('acme', TENANT_SCOPE, true), { wrapper });
  await waitFor(() => {
    expect(result.current.view).toBeDefined();
  });
  expect(result.current.tag).toBe(NO_DRAFT_TAG);
  expect(result.current.changed.size).toBe(0);
});

it('asks for the preview’s account only on a tab that frames one, once the theme is read', async () => {
  const unframed = hookHarness(brandingRoutes(themeAnswer(draftedView(), '"d1"')));
  const quiet = renderHook(() => useScopeBranding('acme', TENANT_SCOPE, false), {
    wrapper: unframed.wrapper,
  });
  await waitFor(() => {
    expect(quiet.result.current.view).toBeDefined();
  });
  expect(unframed.sent.map((request) => request.path)).not.toContain(PI);

  const framed = hookHarness(clientBrandingRoutes(themeAnswer(clientView(), '"c1"')));
  renderHook(() => useScopeBranding('acme', clientScope('c-bill'), true), {
    wrapper: framed.wrapper,
  });
  await waitFor(() => {
    expect(framed.sent.map((request) => request.path)).toContain(`${CTH}/preview/info`);
  });
});

it('keeps the last publish answer for the tabs to mark their refusals from', () => {
  const { wrapper } = hookHarness(brandingRoutes());
  const { result } = renderHook(() => useScopeBranding('acme', TENANT_SCOPE, false), { wrapper });
  expect(result.current.published).toBe(NO_OUTCOME);
  const answer = { ...NO_OUTCOME, toast: 'Theme published' };
  act(() => {
    result.current.setPublished(answer);
  });
  expect(result.current.published).toBe(answer);
});
