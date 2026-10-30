import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useThemeWrites } from '#/features/branding/repository/useThemeWrites';
import { PUBLISHING, SAVING } from '#/features/branding/service';
import { useSectionHold } from '#/features/branding/usecase/useSectionHold';
import { TH } from '#/testing/brandingFixtures';
import { pending } from '#/testing/fakeTransport';
import { hookHarness as harness } from '#/testing/hookHarness';
import { useSavingSections } from '#/shared/repository/useSavingSections';
import { savingKey } from '#/shared/service/savingSections';

const TENANT = { kind: 'tenant' } as const;

function usePage() {
  return {
    writes: useThemeWrites('acme', TENANT),
    colours: useSectionHold('acme', TENANT, undefined, false),
    stylesheet: useSectionHold('acme', TENANT, undefined, false),
  };
}

it('holds a section’s Save while the publication bar publishes', async () => {
  const { wrapper } = harness({ [`POST ${TH}/publish`]: pending() });
  const { result } = renderHook(usePage, { wrapper });
  expect(result.current.colours).toBeUndefined();
  act(() => {
    result.current.writes.publish.run('"d1"').catch(() => undefined);
  });
  await waitFor(() => {
    expect(result.current.colours).toBe(PUBLISHING);
  });
  expect(result.current.stylesheet).toBe(PUBLISHING);
});

it('holds a section’s Save while another section is saving', () => {
  const { wrapper } = harness({});
  const { result } = renderHook(usePage, { wrapper });
  const key = savingKey('acme', 'theme', 'colours');
  act(() => {
    useSavingSections.getState().report(key, true);
  });
  expect(result.current.stylesheet).toBe(SAVING);
  act(() => {
    useSavingSections.getState().report(key, false);
  });
  expect(result.current.stylesheet).toBeUndefined();
});
