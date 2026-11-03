import type { SmtpConfig } from '@odudu/contracts/admin';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useSmtpRecord } from '#/pages/email/repository/useSmtpRecord';
import { useRelaySection } from '#/pages/email/use-cases/useRelaySection';
import { inTurn, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { emailRoutes, OWN_SMTP, SM, smtpAnswer } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const NO_RELAY: SmtpConfig = {
  configured: false,
  host: null,
  port: null,
  from_address: null,
  username: null,
  password_set: false,
  starttls: null,
  effective: 'none',
};

// acme's relay read, with the section mounted once it has answered.
function section(extra: Parameters<typeof emailRoutes>[1] = {}) {
  const harness = hookHarness(emailRoutes(undefined, extra));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return {
    ...harness,
    ...renderHook(
      () => {
        const record = useSmtpRecord('acme');
        const relay = useRelaySection({
          tenant: 'acme',
          config: record.data ?? NO_RELAY,
          etag: record.etag ?? '',
          gone: record.gone,
        });
        return { record, relay };
      },
      { wrapper },
    ),
  };
}

async function read(result: { current: { record: { data: unknown } } }) {
  await waitFor(() => {
    expect(result.current.record.data).toBeDefined();
  });
}

it('shows a save on a stale ETag as the other administrator’s relay beside the edit', async () => {
  const { result, sent } = section({
    [`PUT ${SM}`]: problem(412, 'about:blank', 'Precondition Failed'),
    [`GET ${SM}`]: inTurn(
      smtpAnswer(),
      smtpAnswer({ ...OWN_SMTP, host: 'theirs.example' }, '"m2"'),
    ),
  });
  await read(result);
  act(() => {
    result.current.relay.save.edit('host', 'mine.example');
  });
  act(() => {
    result.current.relay.save.submit();
  });
  await waitFor(() => {
    expect(result.current.relay.save.status).toBe('conflict');
  });
  expect(sent.find((call) => call.method === 'PUT')).toMatchObject({ ifMatch: '"m1"' });
  expect(result.current.relay.save.conflicts[0]).toMatchObject({
    field: 'host',
    theirs: 'theirs.example',
    yours: 'mine.example',
  });
});

it('holds Save, saying why, while the port is not one', async () => {
  const { result } = section();
  await read(result);
  expect(result.current.relay.blocked).toBeUndefined();
  act(() => {
    result.current.relay.save.edit('port', '70000');
  });
  expect(result.current.relay.blocked).toBe(
    'The port is not valid. A whole number from 1 to 65535.',
  );
});

it('says a stored password is kept, and that a moved host will not reuse it', async () => {
  const { result } = section();
  await read(result);
  expect(result.current.relay.passwordNote).toBe(
    'A password is stored and never shown. Leave this empty to keep it.',
  );
  act(() => {
    result.current.relay.save.edit('host', 'other.example');
  });
  expect(result.current.relay.passwordNote).toContain('only kept for the host, port and username');
});

it('never holds the stored password in the form', async () => {
  const { result } = section();
  await read(result);
  expect(result.current.relay.save.values).toMatchObject({ password: '', remove_password: false });
});

it('empties the password field when its removal is asked for, and restores the choice when it is not', async () => {
  const { result } = section();
  await read(result);
  act(() => {
    result.current.relay.save.edit('password', 'typed');
  });
  act(() => {
    result.current.relay.removePassword(true);
  });
  expect(result.current.relay.save.values).toMatchObject({ password: '', remove_password: true });
  act(() => {
    result.current.relay.removePassword(false);
  });
  expect(result.current.relay.save.values.remove_password).toBe(false);
});
