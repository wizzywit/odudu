import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useFlowRecord } from '#/pages/flow/repository/useFlowRecord';
import { useFlowSteps } from '#/pages/flow/use-cases/useFlowSteps';
import { problem } from '#/testing/fakeTransport';
import { flowAnswer, flowRoutes, FL, step } from '#/testing/flowFixtures';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

function steps(extra: Parameters<typeof flowRoutes>[1] = {}) {
  const harness = hookHarness(flowRoutes(undefined, extra));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(
    () => {
      const read = useFlowRecord('acme');
      const flow = useFlowSteps({
        tenant: 'acme',
        data: read.data ?? { items: [], available: [] },
        etag: read.etag ?? '',
        gone: read.gone,
        reading: null,
      });
      return { ready: read.status === 'ready', flow };
    },
    { wrapper },
  );
  return { ...harness, ...view };
}

const order = (result: { current: { flow: { rows: readonly { authenticator: string }[] } } }) =>
  result.current.flow.rows.map((each) => each.authenticator);

async function ready(result: { current: { ready: boolean } }) {
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
}

it('starts from the flow as read, in the order of its indexes', async () => {
  const { result } = steps({
    [`GET ${FL}`]: flowAnswer([
      step(1, 'password', 'alternative'),
      step(0, 'passkey', 'alternative'),
    ]),
  });
  await ready(result);
  expect(order(result)).toEqual(['passkey', 'password']);
});

it('moves a step down and up, and the first cannot move up nor the last down', async () => {
  const { result } = steps();
  await ready(result);
  expect(result.current.flow.rows[0]?.up.enabled).toBe(false);
  expect(result.current.flow.rows.at(-1)?.down.enabled).toBe(false);
  act(() => {
    result.current.flow.move('passkey', 'down');
  });
  expect(order(result)).toEqual(['password', 'passkey', 'otp']);
  act(() => {
    result.current.flow.move('passkey', 'up');
  });
  expect(order(result)).toEqual(['passkey', 'password', 'otp']);
  act(() => {
    result.current.flow.move('passkey', 'up');
  });
  expect(order(result)).toEqual(['passkey', 'password', 'otp']);
});

it('adds an authenticator the registry offers as a step that starts conditional', async () => {
  const { result } = steps();
  await ready(result);
  expect(result.current.flow.offered).toEqual([{ id: 'recovery-code', label: 'recovery-code' }]);
  expect(result.current.flow.adding).toBe('recovery-code');
  expect(result.current.flow.addingRequirement).toBe('conditional');
  act(() => {
    result.current.flow.add();
  });
  expect(result.current.flow.rows.at(-1)).toMatchObject({
    authenticator: 'recovery-code',
    requirement: 'conditional',
  });
  expect(result.current.flow.offered).toEqual([]);
});

it('sets the requirement of a step, and a requirement it does not know as the one a new step starts as', async () => {
  const { result } = steps();
  await ready(result);
  act(() => {
    result.current.flow.setRequirement('password', 'required');
  });
  expect(result.current.flow.rows.find((each) => each.authenticator === 'password')).toMatchObject({
    requirement: 'required',
  });
  act(() => {
    result.current.flow.setRequirement('password', 'nonesuch');
  });
  expect(result.current.flow.rows.find((each) => each.authenticator === 'password')).toMatchObject({
    requirement: 'conditional',
  });
});

it('saves the steps as they stand, in the order shown and without an index, on the ETag read', async () => {
  const { result, sent } = steps({
    [`PUT ${FL}`]: flowAnswer(
      [step(0, 'passkey', 'alternative'), step(1, 'password', 'alternative')],
      '"f2"',
    ),
  });
  await ready(result);
  act(() => {
    result.current.flow.save.edit('steps', [
      { authenticator: 'passkey', requirement: 'alternative' },
      { authenticator: 'password', requirement: 'alternative' },
    ]);
  });
  act(() => {
    result.current.flow.save.submit();
  });
  await waitFor(() => {
    expect(sent.find((call) => call.method === 'PUT')?.body).toEqual([
      { authenticator: 'passkey', requirement: 'alternative' },
      { authenticator: 'password', requirement: 'alternative' },
    ]);
  });
  expect(sent.find((call) => call.method === 'PUT')?.ifMatch).toBe('"f1"');
});

it('puts a refusal of the order under the steps in the console’s words', async () => {
  const { result } = steps({
    [`PUT ${FL}`]: problem(400, 'about:blank#flow-empty', 'Bad Request'),
  });
  await ready(result);
  act(() => {
    result.current.flow.move('passkey', 'down');
  });
  act(() => {
    result.current.flow.save.submit();
  });
  await waitFor(() => {
    expect(result.current.flow.save.fieldErrors.steps).toBe(
      'The flow has no step. Add one: nobody could sign in to a tenant with no flow.',
    );
  });
});
