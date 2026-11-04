import { expect, it } from 'vitest';
import {
  domainActionOutcome,
  registerFailure,
  registeredText,
  registerInstruction,
  verifyInstruction,
  verifyFailureText,
} from '#/pages/domains/services/outcome';
import type { GatewayFailure, GatewayResult } from '#/shared/lib/services/result';

const host = 'login.acme.com';

function refused(status: number, type: string, detail?: string): GatewayFailure {
  return {
    ok: false,
    kind: 'problem',
    problem: { type, title: 'Refused', status, ...(detail === undefined ? {} : { detail }) },
  };
}

const ok: GatewayResult<unknown> = { ok: true, status: 200, data: {}, etag: null, next: null };

it('says what each action came to', () => {
  expect(domainActionOutcome('activate', host, ok)).toEqual({
    done: true,
    text: 'login.acme.com is now the tenant’s address.',
  });
  expect(domainActionOutcome('deactivate', host, ok).text).toBe(
    'The tenant signs in at its path address again.',
  );
  expect(domainActionOutcome('remove', host, ok).text).toBe('login.acme.com was removed.');
});

it('closes the dialog and says to look again when the address moved first, on a 412', () => {
  const outcome = domainActionOutcome('activate', host, refused(412, 'about:blank'));
  expect(outcome.done).toBe(false);
  expect(outcome.closes).toBe(true);
  expect(outcome.text).toContain('changed');
  expect(outcome.text).toContain('read again');
});

it('treats a missing precondition as a stale one: close, read again, ask again', () => {
  const outcome = domainActionOutcome('activate', host, refused(428, 'about:blank'));
  expect(outcome.done).toBe(false);
  expect(outcome.closes).toBe(true);
  expect(outcome.text).toContain('read again');
});

it('does the same on a 409 that says the address moved', () => {
  const outcome = domainActionOutcome(
    'deactivate',
    host,
    refused(409, 'about:blank#domain-switch-conflict'),
  );
  expect(outcome.closes).toBe(true);
});

it('treats a removal of a domain that is gone as done, and a switch to one as stale', () => {
  expect(domainActionOutcome('remove', host, refused(404, 'about:blank')).done).toBe(true);
  const switched = domainActionOutcome('activate', host, refused(404, 'about:blank'));
  expect(switched.done).toBe(false);
  expect(switched.closes).toBe(true);
});

it('keeps the dialog open and says why a domain that is not verified cannot be the address', () => {
  const outcome = domainActionOutcome(
    'activate',
    host,
    refused(409, 'about:blank#domain-not-verified'),
  );
  expect(outcome.done).toBe(false);
  expect(outcome.closes).toBeUndefined();
  expect(outcome.text).toContain('Verify it first');
});

it('says the address cannot be removed, and what to do first', () => {
  const outcome = domainActionOutcome('remove', host, refused(409, 'about:blank#domain-canonical'));
  expect(outcome.text).toContain('Switch back');
});

it('names manage-domains when the server refuses with a 403', () => {
  const outcome = domainActionOutcome('activate', host, refused(403, 'about:blank'));
  expect(outcome.text).toContain('manage-domains');
});

it('says why a verification did not land', () => {
  expect(verifyFailureText(host, refused(409, 'about:blank#domain-failed'))).toContain(
    'register it again',
  );
  expect(verifyFailureText(host, refused(429, 'about:blank#domain-verify-throttled'))).toContain(
    'too recently',
  );
  expect(verifyFailureText(host, refused(409, 'about:blank#domain-verified-elsewhere'))).toContain(
    'another tenant',
  );
});

it('says the record to publish after a registration', () => {
  expect(registeredText(host)).toContain('Publish the TXT record');
});

it('places a refused host under the host field and any other refusal as a message', () => {
  expect(
    registerFailure(refused(422, 'about:blank#domain-host-invalid', 'the host is not a name'))
      .errors,
  ).toEqual({ host: 'The host is not a name.' });
  expect(
    registerFailure(refused(409, 'about:blank#domain-already-registered', 'registered already'))
      .errors,
  ).toEqual({ host: 'Registered already.' });
  const limit = registerFailure(
    refused(409, 'about:blank#domain-limit', 'hold as many as allowed'),
  );
  expect(limit.errors).toEqual({});
  expect(limit.message).toBe('Hold as many as allowed.');
});

const answered = (data: unknown): GatewayResult<never> =>
  ({ ok: true, status: 200, data, etag: null, next: null }) as GatewayResult<never>;

const base = {
  id: 'd',
  host,
  state: 'verified',
  canonical: false,
  verified_at: null,
  last_checked_at: null,
  dns_record: null,
} as const;

it('tells a verification as one instruction: a toast when verified, a message when not', () => {
  expect(verifyInstruction(host, answered(base))).toEqual({
    message: null,
    toast: 'login.acme.com is verified. It can now be made the tenant’s address.',
    report: false,
  });
  const pending = verifyInstruction(host, answered({ ...base, state: 'pending' }));
  expect(pending.toast).toBeNull();
  expect(pending.message).toContain('does not show its record yet');
  const refusedTwice = verifyInstruction(host, refused(403, 'about:blank'));
  expect(refusedTwice.report).toBe(true);
  expect(refusedTwice.message).toContain('manage-domains');
});

it('tells a registration as one instruction: the host emptied on success, kept on a refusal', () => {
  const done = registerInstruction('typed.acme.com', answered({ ...base, host: 'typed.acme.com' }));
  expect(done).toMatchObject({ host: '', error: undefined, message: null, report: false });
  expect(done.toast).toContain('Publish the TXT record');
  const refusal = registerInstruction(
    'Typed.acme.com',
    refused(422, 'about:blank#domain-host-invalid', 'not a name'),
  );
  expect(refusal).toMatchObject({ host: 'Typed.acme.com', error: 'Not a name.', toast: null });
});
