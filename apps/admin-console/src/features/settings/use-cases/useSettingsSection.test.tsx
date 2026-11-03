import { act, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  useGeneralSection,
  useSettingsSection,
} from '#/features/settings/use-cases/useSettingsSection';
import { inTurn, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { settingsAnswer, ST } from '#/testing/settingsFixtures';
import { settingsHarness } from '#/testing/settingsSectionHarness';

afterEach(() => {
  resetConsole();
});

it('shows a save on a stale ETag as the other administrator’s value beside the edit', async () => {
  const { render, sent } = settingsHarness({
    [`PATCH ${ST}`]: problem(412, 'about:blank', 'Precondition Failed'),
    [`GET ${ST}`]: inTurn(
      settingsAnswer(),
      settingsAnswer({ sso_session_idle_seconds: 7200 }, '"s2"'),
    ),
  });
  const { result } = render(useSettingsSection, 'sessions');
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.used.edit('sso_session_idle_seconds', 3600);
  });
  act(() => {
    result.current.used.submit();
  });
  await waitFor(() => {
    expect(result.current.used.status).toBe('conflict');
  });
  expect(sent.find((call) => call.method === 'PATCH')).toMatchObject({ ifMatch: '"s1"' });
  const [conflict] = result.current.used.conflicts;
  expect(conflict).toMatchObject({ field: 'sso_session_idle_seconds', theirs: 7200, yours: 3600 });
  expect(conflict?.describe?.(7200)).toBe('7200 s · 2 hours');
});

it('names manage-tenant when the server refuses the save', async () => {
  const { render } = settingsHarness({
    [`PATCH ${ST}`]: problem(403, 'about:blank', 'Forbidden'),
  });
  const { result } = render(useSettingsSection, 'sessions');
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.used.edit('sso_session_idle_seconds', 3600);
  });
  act(() => {
    result.current.used.submit();
  });
  await waitFor(() => {
    expect(result.current.used.message).toContain('manage-tenant');
  });
});

it('asks first when an enabled tenant is switched off, and names the tenant in what it says', async () => {
  const { render, sent } = settingsHarness({
    [`PATCH ${ST}`]: settingsAnswer({ enabled: false }, '"s2"'),
  });
  const { result } = render(useGeneralSection, 'general');
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.used.save.edit('enabled', false);
  });
  let sentAtOnce = true;
  act(() => {
    sentAtOnce = result.current.used.submit();
  });
  expect(sentAtOnce).toBe(false);
  expect(result.current.used.confirming).toBe(true);
  expect(result.current.used.consequence).toContain('Nobody can sign in to acme');
  expect(result.current.used.consequence).toContain('Your own console session in acme ends too.');
  expect(sent.some((call) => call.method === 'PATCH')).toBe(false);
  act(() => {
    result.current.used.confirm();
  });
  expect(result.current.used.confirming).toBe(false);
  await waitFor(() => {
    expect(sent.find((call) => call.method === 'PATCH')).toMatchObject({
      body: { enabled: false },
    });
  });
});

it('saves at once when the tenant stays enabled', async () => {
  const { render, sent } = settingsHarness({
    [`PATCH ${ST}`]: settingsAnswer({ display_name: 'Acme Inc' }, '"s2"'),
  });
  const { result } = render(useGeneralSection, 'general');
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.used.save.edit('display_name', 'Acme Inc');
  });
  act(() => {
    result.current.used.submit();
  });
  expect(result.current.used.confirming).toBe(false);
  await waitFor(() => {
    expect(sent.find((call) => call.method === 'PATCH')?.body).toEqual({
      display_name: 'Acme Inc',
    });
  });
});

it('saves at once when a disabled tenant is switched on', async () => {
  const { render, sent } = settingsHarness({
    [`GET ${ST}`]: settingsAnswer({ enabled: false }),
    [`PATCH ${ST}`]: settingsAnswer({ enabled: true }, '"s2"'),
  });
  const { result } = render(useGeneralSection, 'general');
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.used.save.edit('enabled', true);
  });
  act(() => {
    result.current.used.submit();
  });
  expect(result.current.used.confirming).toBe(false);
  await waitFor(() => {
    expect(sent.find((call) => call.method === 'PATCH')?.body).toEqual({ enabled: true });
  });
});
