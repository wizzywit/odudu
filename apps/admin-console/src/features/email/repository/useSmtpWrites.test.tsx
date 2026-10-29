import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSmtpRemove, useSmtpTest } from '#/features/email/repository/useSmtpWrites';
import { json, problem } from '#/testing/fakeTransport';
import { hookHarness as harness, rejectingTransport } from '#/testing/hookHarness';
import { SM } from '#/testing/settingsFixtures';

it('sends a test message to the address given and answers what the server said', async () => {
  const { wrapper, sent } = harness({ [`POST ${SM}/test`]: json({ sent: true }) });
  const { result } = renderHook(() => useSmtpTest('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run({ to: 'a@b.example', clientId: null });
  });
  expect(answer).toMatchObject({ ok: true, data: { sent: true } });
  expect(sent[0]).toMatchObject({ method: 'POST', body: { to: 'a@b.example' } });
  expect(sent[0]?.body).not.toHaveProperty('client_id');
});

it('names the client the message is sent as, by its row id', async () => {
  const { wrapper, sent } = harness({ [`POST ${SM}/test`]: json({ sent: true }) });
  const { result } = renderHook(() => useSmtpTest('acme'), { wrapper });
  await act(async () => {
    await result.current.run({ to: 'a@b.example', clientId: 'c-bill' });
  });
  expect(sent[0]).toMatchObject({ body: { to: 'a@b.example', client_id: 'c-bill' } });
});

it('answers a send the server refused as the refusal, not as a thrown error', async () => {
  const { wrapper } = harness({
    [`POST ${SM}/test`]: problem(502, 'about:blank', 'Bad Gateway', { detail: 'ECONNREFUSED' }),
  });
  const { result } = renderHook(() => useSmtpTest('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run({ to: 'a@b.example', clientId: null });
  });
  expect(answer).toMatchObject({ ok: false, kind: 'problem' });
  await waitFor(() => {
    expect(result.current.busy).toBe(false);
  });
});

it('removes the relay', async () => {
  const { wrapper, sent } = harness({
    [`DELETE ${SM}`]: () => new Response(null, { status: 204 }),
  });
  const { result } = renderHook(() => useSmtpRemove('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run();
  });
  expect(answer?.ok).toBe(true);
  expect(sent[0]).toMatchObject({ method: 'DELETE' });
});

it('answers a test whose send threw as a defect, never as a throw', async () => {
  const { wrapper } = harness({}, rejectingTransport());
  const { result } = renderHook(() => useSmtpTest('acme'), { wrapper });
  await act(async () => {
    expect(await result.current.run({ to: 'a@b.example', clientId: null })).toEqual({
      ok: false,
      kind: 'defect',
    });
  });
});

it('answers a removal whose send threw as a defect, never as a throw', async () => {
  const { wrapper } = harness({}, rejectingTransport());
  const { result } = renderHook(() => useSmtpRemove('acme'), { wrapper });
  await act(async () => {
    expect(await result.current.run()).toEqual({ ok: false, kind: 'defect' });
  });
});
