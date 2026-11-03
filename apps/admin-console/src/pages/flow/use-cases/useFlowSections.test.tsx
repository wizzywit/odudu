import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useFlowSections } from '#/pages/flow/use-cases/useFlowSections';
import { json } from '#/testing/fakeTransport';
import { flowRoutes, settingsAnswer, ST } from '#/testing/flowFixtures';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

function sections(extra: Parameters<typeof flowRoutes>[1] = {}) {
  const harness = hookHarness(flowRoutes(undefined, extra));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return renderHook(() => useFlowSections('acme'), { wrapper });
}

it('has nothing to say of the one-time password until the settings are read', () => {
  const { result } = sections();
  expect(result.current.reading).toBeNull();
  expect(result.current.otp).toBeNull();
  expect(result.current.unread).toBe(false);
});

it('reads whom the step asks from the settings, and offers the section with their ETag', async () => {
  const { result } = sections({ [`GET ${ST}`]: settingsAnswer(true, '"s9"') });
  await waitFor(() => {
    expect(result.current.otp).not.toBeNull();
  });
  expect(result.current.reading).toBe('Asked of every subject.');
  expect(result.current.otp?.etag).toBe('"s9"');
  expect(result.current.words.loading).toBe('Loading the flow');
});

it('says the settings could not be read, and offers no section for them', async () => {
  const { result } = sections({
    [`GET ${ST}`]: json({ type: 'about:blank', title: 'x', status: 500 }, 500),
  });
  await waitFor(() => {
    expect(result.current.unread).toBe(true);
  });
  expect(result.current.otp).toBeNull();
});
