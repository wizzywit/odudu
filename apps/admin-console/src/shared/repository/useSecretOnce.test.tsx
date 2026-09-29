import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useSecretOnce } from '#/shared/repository/useSecretOnce.ts';
import type { Gateway } from '#/shared/transport/gateway.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { Button } from '#/shared/view/Button.tsx';
import { SecretDialog } from '#/shared/view/SecretDialog.tsx';
import { fakeTransport, json, pending, problem, type Answer } from '#/testing/fakeTransport.ts';

const SECRET = 's3cr3t-shown-once-Qm9vYmFy';
const ROTATE = 'POST /console/api/admin/tenants/acme/clients/c1/secret';

const rotatedSchema = z.object({ client_id: z.string(), client_secret: z.string() });

function rotate(gateway: Gateway, clientId: string) {
  return gateway.request('POST', `admin/tenants/acme/clients/${clientId}/secret`, {
    schema: rotatedSchema,
  });
}

const options = {
  run: rotate,
  split: (data: z.infer<typeof rotatedSchema>) => ({
    secret: data.client_secret,
    rest: { clientId: data.client_id },
  }),
};

function harness(answer: Answer) {
  const fake = fakeTransport({ [ROTATE]: answer });
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportContext>
  );
  return { ...fake, queryClient, wrapper };
}

function cached(queryClient: QueryClient): string {
  return JSON.stringify(
    queryClient
      .getMutationCache()
      .getAll()
      .map((m) => m.state),
  );
}

it('hands the secret to its dialog and keeps it out of the mutation cache', async () => {
  const { wrapper, queryClient } = harness(
    json({ client_id: 'billing-portal', client_secret: SECRET }),
  );
  const { result } = renderHook(() => useSecretOnce(options), { wrapper });
  act(() => {
    result.current.start('c1');
  });
  await waitFor(() => {
    expect(result.current.secret).toBe(SECRET);
  });
  expect(result.current.outcome).toEqual({ clientId: 'billing-portal' });
  expect(cached(queryClient)).not.toContain(SECRET);

  act(() => {
    result.current.close();
  });
  expect(result.current.secret).toBeNull();
  expect(JSON.stringify(result.current)).not.toContain(SECRET);
  expect(cached(queryClient)).not.toContain(SECRET);
  expect(result.current.outcome).toEqual({ clientId: 'billing-portal' });
});

it('sends one request however often it is started while one is in flight', async () => {
  const { wrapper, sent } = harness(pending());
  const { result } = renderHook(() => useSecretOnce(options), { wrapper });
  act(() => {
    result.current.start('c1');
    result.current.start('c1');
  });
  await waitFor(() => {
    expect(result.current.busy).toBe(true);
  });
  act(() => {
    result.current.start('c1');
  });
  expect(sent).toHaveLength(1);
});

it('reports a refusal and shows no secret', async () => {
  const { wrapper } = harness(problem(403, 'about:blank', 'Forbidden'));
  const { result } = renderHook(() => useSecretOnce(options), { wrapper });
  act(() => {
    result.current.start('c1');
  });
  await waitFor(() => {
    expect(result.current.failure).toEqual(expect.objectContaining({ kind: 'problem' }));
  });
  expect(result.current.secret).toBeNull();
  expect(result.current.busy).toBe(false);
});

function Rotate() {
  const once = useSecretOnce(options);
  return (
    <>
      <Button
        onPress={() => {
          once.start('c1');
        }}
      >
        Generate a new secret
      </Button>
      <SecretDialog
        secret={once.secret}
        title="New secret"
        label="client secret"
        onClose={once.close}
      >
        The previous secret stopped working.
      </SecretDialog>
    </>
  );
}

it('leaves nothing of the secret on the page once its dialog closes', async () => {
  const user = userEvent.setup();
  const { wrapper, queryClient } = harness(
    json({ client_id: 'billing-portal', client_secret: SECRET }),
  );
  render(<Rotate />, { wrapper });
  await user.click(screen.getByRole('button', { name: 'Generate a new secret' }));
  expect(await screen.findByText(SECRET)).toBeVisible();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(document.body.innerHTML).not.toContain(SECRET);
  expect(cached(queryClient)).not.toContain(SECRET);
});
