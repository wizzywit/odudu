import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useTenantSettingsRead } from '#/entities/tenant';
import { useOtpRequirement } from '#/features/flow/use-cases/useOtpRequirement';
import { problem } from '#/testing/fakeTransport';
import { flowRoutes, settingsAnswer, ST } from '#/testing/flowFixtures';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

function otp(extra: Parameters<typeof flowRoutes>[1] = {}) {
  const harness = hookHarness(flowRoutes(undefined, extra));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(
    () => {
      const read = useTenantSettingsRead('acme');
      const requirement = useOtpRequirement({
        tenant: 'acme',
        data: read.data ?? {},
        etag: read.etag ?? '',
        gone: read.gone,
      });
      return { ready: read.status === 'ready', requirement };
    },
    { wrapper },
  );
  return { ...harness, ...view };
}

async function ready(result: { current: { ready: boolean } }) {
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
}

it('reads whom the step asks from the saved setting', async () => {
  const { result } = otp();
  await ready(result);
  expect(result.current.requirement.reading).toBe(
    'Asked only of subjects who set up an authenticator app.',
  );
  expect(result.current.requirement.save.values.otp_required).toBe(false);
});

it('saves the setting alone, on the settings ETag', async () => {
  const { result, sent } = otp({ [`PATCH ${ST}`]: settingsAnswer(true, '"s2"') });
  await ready(result);
  act(() => {
    result.current.requirement.save.edit('otp_required', true);
  });
  act(() => {
    result.current.requirement.save.submit();
  });
  await waitFor(() => {
    expect(sent.find((call) => call.method === 'PATCH')).toMatchObject({
      ifMatch: '"s1"',
      body: { otp_required: true },
    });
  });
});

it('names manage-tenant when the server refuses the save', async () => {
  const { result } = otp({ [`PATCH ${ST}`]: problem(403, 'about:blank', 'Forbidden') });
  await ready(result);
  act(() => {
    result.current.requirement.save.edit('otp_required', true);
  });
  act(() => {
    result.current.requirement.save.submit();
  });
  await waitFor(() => {
    expect(result.current.requirement.save.message).toContain('manage-tenant');
  });
});
