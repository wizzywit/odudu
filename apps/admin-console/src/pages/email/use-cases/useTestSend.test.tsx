import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useTestSend } from '#/pages/email/use-cases/useTestSend';
import { json, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { emailRoutes, SM } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

function sending(
  configured: boolean,
  extra: Parameters<typeof emailRoutes>[1] = {},
  unsaved = false,
) {
  const harness = hookHarness(emailRoutes(undefined, extra));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return { ...harness, ...renderHook(() => useTestSend('acme', configured, unsaved), { wrapper }) };
}

async function listed(result: { current: ReturnType<typeof useTestSend> }) {
  await waitFor(() => {
    expect(result.current.picker.status).toBe('ready');
  });
}

const SENT = { [`POST ${SM}/test`]: json({ sent: true }) };

it('sends as the client the administrator signed in with until another is chosen', async () => {
  const { result, sent } = sending(true, SENT);
  await listed(result);
  expect(result.current.selected).toEqual(['c-admin']);
  act(() => {
    result.current.setTo('a@b.example');
  });
  act(() => {
    result.current.send();
  });
  await waitFor(() => {
    expect(result.current.outcome?.tone).toBe('success');
  });
  expect(sent.find((call) => call.method === 'POST')?.body).toEqual({
    to: 'a@b.example',
    client_id: 'c-admin',
  });
});

it('sends with no client_id once the tenant’s own look is chosen', async () => {
  const { result, sent } = sending(true, SENT);
  await listed(result);
  act(() => {
    result.current.useTenantOwn();
  });
  expect(result.current.selected).toEqual([]);
  expect(result.current.summary).toBe('Sent in the tenant’s own look.');
  act(() => {
    result.current.setTo('a@b.example');
  });
  act(() => {
    result.current.send();
  });
  await waitFor(() => {
    expect(result.current.outcome).not.toBeNull();
  });
  expect(sent.find((call) => call.method === 'POST')?.body).toEqual({ to: 'a@b.example' });
});

it('sends nothing, saying why, while the tenant has no relay of its own', async () => {
  const { result, sent } = sending(false, SENT);
  await listed(result);
  act(() => {
    result.current.setTo('a@b.example');
  });
  expect(result.current.blocked).toBe(
    'Save a relay of this tenant’s own first: the test sends through the saved one.',
  );
  act(() => {
    result.current.send();
  });
  expect(sent.some((call) => call.method === 'POST')).toBe(false);
});

it('says the server’s reason for a 400 and for a 502', async () => {
  const bad = sending(true, {
    [`POST ${SM}/test`]: problem(400, 'about:blank', 'Bad Request', {
      detail: 'this tenant has no SMTP configuration',
    }),
  });
  await listed(bad.result);
  act(() => {
    bad.result.current.setTo('a@b.example');
  });
  act(() => {
    bad.result.current.send();
  });
  await waitFor(() => {
    expect(bad.result.current.outcome?.text).toBe(
      'Not sent. The server said: this tenant has no SMTP configuration.',
    );
  });
  const failed = sending(true, {
    [`POST ${SM}/test`]: problem(502, 'about:blank', 'Bad Gateway', {
      detail: 'the relay could not be reached',
    }),
  });
  await listed(failed.result);
  act(() => {
    failed.result.current.setTo('a@b.example');
  });
  act(() => {
    failed.result.current.send();
  });
  await waitFor(() => {
    expect(failed.result.current.outcome?.text).toBe(
      'Not sent. The relay failed: the relay could not be reached.',
    );
  });
});

it('says the test uses the saved relay, and not the edits, only while there are edits', () => {
  expect(sending(true).result.current.rule).toBe(
    'Sends one message through the saved relay and tells what the server answered.',
  );
  expect(sending(true, {}, true).result.current.rule).toBe(
    'Sends one message through the saved relay and tells what the server answered. The test uses the saved relay, not the changes above.',
  );
});
