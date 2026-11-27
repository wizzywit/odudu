import { afterEach, expect, it } from 'vitest';
import { useTaskRequests } from '#/entities/assistant/repository/useTaskRequests';

const ASK = { tenant: 'acme', profile: 'review-client', draft: 'Review.' };

afterEach(() => {
  useTaskRequests.setState({ gate: null, request: null, carry: null });
});

it('ignores a request when no gate is mounted for its tenant, so none waits for a later one', () => {
  useTaskRequests.getState().ask(ASK);
  expect(useTaskRequests.getState().request).toBeNull();
  const detach = useTaskRequests.getState().attach('demo');
  useTaskRequests.getState().ask(ASK);
  expect(useTaskRequests.getState().request).toBeNull();
  detach();
});

it('keeps a request for the tenant whose gate is mounted, and drops it when that gate goes', () => {
  const detach = useTaskRequests.getState().attach('acme');
  useTaskRequests.getState().ask(ASK);
  expect(useTaskRequests.getState().request).toMatchObject(ASK);
  detach();
  expect(useTaskRequests.getState().request).toBeNull();
  expect(useTaskRequests.getState().gate).toBeNull();
});

it('numbers each request, so asking for the same task twice is two requests', () => {
  const detach = useTaskRequests.getState().attach('acme');
  useTaskRequests.getState().ask(ASK);
  const first = useTaskRequests.getState().request?.seq;
  useTaskRequests.getState().ask(ASK);
  expect(useTaskRequests.getState().request?.seq).not.toBe(first);
  detach();
});
