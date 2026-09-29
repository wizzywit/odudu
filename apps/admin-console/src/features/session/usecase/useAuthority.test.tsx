import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useRefusal } from '#/features/session/usecase/useAuthority.ts';
import { SignedInContext } from '#/features/session/usecase/useSignedIn.ts';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useTransport, TransportContext } from '#/shared/transport/useTransport.ts';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { fakeTransport, json, problem } from '#/testing/fakeTransport.ts';

const WHOAMI = 'GET /console/api/admin/tenants/acme/whoami';
const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

// A section as a feature will write one: it sends, and hands the answer over.
function RotateSecret() {
  const { gateway } = useTransport();
  const { refused, report } = useRefusal('acme');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          gateway
            .request('POST', 'admin/tenants/acme/clients/c1/secret', { schema: z.unknown() })
            .then((result) => {
              report(result, 'manage-clients');
            })
            .catch(() => undefined);
        }}
      >
        Rotate secret
      </button>
      {refused === null ? null : (
        <CapabilityNote capability={refused}>Rotating a client secret</CapabilityNote>
      )}
    </>
  );
}

function mount(answer: ReturnType<typeof json>) {
  const fake = fakeTransport({
    [WHOAMI]: json({
      subjectId: 's1',
      issuerTenantId: 't1',
      capabilities: ['manage-clients'],
      crossTenant: false,
    }),
    'POST /console/api/admin/tenants/acme/clients/c1/secret': answer,
  });
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={createQueryClient()}>
        <SignedInContext value={{ principal: GRACE, ended: null }}>
          <RotateSecret />
        </SignedInContext>
      </QueryClientProvider>
    </TransportContext>,
  );
  return fake;
}

const whoamiReads = (calls: readonly { method: string; path: string }[]) =>
  calls.filter((call) => `${call.method} ${call.path}` === WHOAMI).length;

it('says which capability a refused request needed, and reads whoami again', async () => {
  const user = userEvent.setup();
  const { calls } = mount(problem(403, 'about:blank', 'Forbidden'));
  await waitFor(() => {
    expect(whoamiReads(calls)).toBe(1);
  });

  await user.click(screen.getByRole('button', { name: 'Rotate secret' }));

  expect(await screen.findByRole('note')).toHaveTextContent(
    'Rotating a client secret needs the manage-clients capability.',
  );
  await waitFor(() => {
    expect(whoamiReads(calls)).toBe(2);
  });
});

it('leaves any other answer to the caller', async () => {
  const user = userEvent.setup();
  const { calls } = mount(problem(409, 'about:blank', 'Conflict'));
  await waitFor(() => {
    expect(whoamiReads(calls)).toBe(1);
  });
  await user.click(screen.getByRole('button', { name: 'Rotate secret' }));
  await waitFor(() => {
    expect(calls.some((call) => call.method === 'POST')).toBe(true);
  });
  expect(screen.queryByRole('note')).toBeNull();
  expect(whoamiReads(calls)).toBe(1);
});

it('asks whoami nothing while nobody is signed in', async () => {
  const fake = fakeTransport({ [WHOAMI]: json({}) });
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={createQueryClient()}>
        <RotateSecret />
      </QueryClientProvider>
    </TransportContext>,
  );
  await screen.findByRole('button', { name: 'Rotate secret' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(whoamiReads(fake.calls)).toBe(0);
});

it('asks whoami nothing once the session has ended, until the principal is back', async () => {
  const fake = fakeTransport({ [WHOAMI]: json({}) });
  render(
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={createQueryClient()}>
        <SignedInContext value={{ principal: GRACE, ended: GRACE }}>
          <RotateSecret />
        </SignedInContext>
      </QueryClientProvider>
    </TransportContext>,
  );
  await screen.findByRole('button', { name: 'Rotate secret' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(whoamiReads(fake.calls)).toBe(0);
});

it('reads whoami again for a part that mounts once what it said has gone stale', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  try {
    const fake = fakeTransport({ [WHOAMI]: json({}) });
    const client = createQueryClient();
    const tree = (parts: number) => (
      <TransportContext value={fake.transport}>
        <QueryClientProvider client={client}>
          <SignedInContext value={{ principal: GRACE, ended: null }}>
            {Array.from({ length: parts }, (_, i) => (
              <RotateSecret key={i} />
            ))}
          </SignedInContext>
        </QueryClientProvider>
      </TransportContext>
    );
    const view = render(tree(1));
    await vi.advanceTimersByTimeAsync(10);
    expect(whoamiReads(fake.calls)).toBe(1);
    view.rerender(tree(2));
    await vi.advanceTimersByTimeAsync(10);
    expect(whoamiReads(fake.calls)).toBe(1);
    await vi.advanceTimersByTimeAsync(31_000);
    view.rerender(tree(3));
    await vi.advanceTimersByTimeAsync(10);
    expect(whoamiReads(fake.calls)).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});
