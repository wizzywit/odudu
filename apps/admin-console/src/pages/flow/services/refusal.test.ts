import { describe, expect, it } from 'vitest';
import type { Step } from '#/pages/flow/services/steps';
import { flowOutcome } from '#/pages/flow/services/refusal';

const AVAILABLE = ['password', 'passkey', 'otp', 'recovery-code'];
const SENT: readonly Step[] = [
  { authenticator: 'sms', requirement: 'required' },
  { authenticator: 'password', requirement: 'required' },
  { authenticator: 'password', requirement: 'alternative' },
];

function bad(type: string, errors?: { path: string; message: string }[]) {
  return {
    ok: false as const,
    kind: 'problem' as const,
    problem: {
      type,
      title: 'Bad Request',
      status: 400,
      detail: 'prose the console does not read',
      ...(errors === undefined ? {} : { errors }),
    },
  };
}

function said(result: ReturnType<typeof flowOutcome>): string | undefined {
  if (result.ok || result.kind !== 'problem') return undefined;
  return result.problem.errors?.[0]?.message;
}

function outcome(failure: ReturnType<typeof bad>) {
  return flowOutcome(failure, SENT, AVAILABLE);
}

describe('flowOutcome', () => {
  it('words a flow with no step', () => {
    expect(said(outcome(bad('about:blank#flow-empty')))).toMatch(/^The flow has no step\./u);
  });

  it('words a flow whose every step is disabled', () => {
    expect(said(outcome(bad('about:blank#flow-no-enabled-step')))).toMatch(
      /^Every step is disabled/u,
    );
  });

  it('words a flow with no first challenge, naming what can start a sign-in', () => {
    const text = said(outcome(bad('about:blank#flow-no-first-challenge')));
    expect(text).toContain('only the password step can run');
    expect(text).toContain('cannot be skipped');
  });

  it('names the step an unknown authenticator is, from its path in what was sent', () => {
    const text = said(
      outcome(
        bad('about:blank#flow-unknown-authenticator', [
          { path: '[0].authenticator', message: 'is not a registered authenticator' },
        ]),
      ),
    );
    expect(text).toBe(
      '“sms” is not an authenticator this server has. It has password, passkey, otp and recovery-code.',
    );
  });

  it('names the step a repeat is, from its path in what was sent', () => {
    const text = said(
      outcome(
        bad('about:blank#flow-duplicate-authenticator', [
          { path: '[2].authenticator', message: 'repeats an earlier step' },
        ]),
      ),
    );
    expect(text).toBe('“password” is a step twice. An authenticator is one step.');
  });

  it('words a refusal whose path names no step without inventing a step', () => {
    expect(said(outcome(bad('about:blank#flow-unknown-authenticator')))).toBe(
      'A step names an authenticator this server does not have. It has password, passkey, otp and recovery-code.',
    );
    expect(said(outcome(bad('about:blank#flow-duplicate-authenticator')))).toBe(
      'An authenticator is a step twice. An authenticator is one step.',
    );
  });

  it('keeps the title for a 400 of a type it does not know, and says nothing of the detail', () => {
    expect(said(outcome(bad('about:blank')))).toBe('Bad Request');
  });

  it('puts the wording under the steps in place of the paths the server named', () => {
    const result = outcome(
      bad('about:blank#flow-duplicate-authenticator', [
        { path: '[2].authenticator', message: 'm' },
      ]),
    );
    const paths = result.ok || result.kind !== 'problem' ? [] : (result.problem.errors ?? []);
    expect(paths.map((error) => error.path)).toEqual(['steps']);
  });

  it('leaves a success, a lost answer and any other status as it came', () => {
    const lost = { ok: false as const, kind: 'network' as const };
    expect(flowOutcome(lost, SENT, AVAILABLE)).toBe(lost);
    const stale = {
      ok: false as const,
      kind: 'problem' as const,
      problem: { type: 'about:blank', title: 'x', status: 412 },
    };
    expect(flowOutcome(stale, SENT, AVAILABLE)).toBe(stale);
    const saved = { ok: true as const, status: 200, data: 1, etag: null, next: null };
    expect(flowOutcome(saved, SENT, AVAILABLE)).toBe(saved);
  });
});
