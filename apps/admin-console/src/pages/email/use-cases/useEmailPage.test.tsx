import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useEmailArea, useEmailPage } from '#/pages/email/use-cases/useEmailPage';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { emailRoutes } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

it('takes the area and the title for the gate before anything is read', () => {
  const { result } = renderHook(() => useEmailArea());
  expect(result.current.area.path).toBe('email');
  expect(result.current.title).toBe('Email');
  expect(result.current.description).toBe(
    "The relay this tenant's verification and reset mail goes through.",
  );
});

it('reads the relay and carries the words of the page', async () => {
  const harness = hookHarness(emailRoutes());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const { result } = renderHook(() => useEmailPage('acme'), { wrapper });
  await waitFor(() => {
    expect(result.current.record.data?.effective).toBe('tenant');
  });
  expect(result.current.words.loading).toBe('Loading the mail relay');
});
