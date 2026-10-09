import { describe, expect, it } from 'vitest';
import type { GatewayFailure } from '#/shared/service/result.ts';
import { actionsMailProblem } from '#/features/subjects/service/actions.ts';
import {
  mailFailure,
  mailFieldErrors,
  mailOutcome,
  mailSentText,
  mailRefusal,
} from '#/features/subjects/service/mail.ts';

const failure = (kind: 'network' | 'schema' | 'defect'): GatewayFailure => ({ ok: false, kind });

const refusal = (
  status: number,
  extra: { type?: string; detail?: string; errors?: { path: string; message: string }[] } = {},
): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: `T${String(status)}`, status, ...extra },
});

describe('a mail the server would not send', () => {
  it('explains each refusal in words, naming where it is fixed', () => {
    expect(mailRefusal('about:blank#no-email', 'ada')).toEqual({
      text: 'ada has no email address. Add one under Profile first.',
      fix: 'profile',
    });
    expect(mailRefusal('about:blank#no-mail-relay', 'ada')?.fix).toBe('email');
    expect(mailRefusal('about:blank#reset-password-off', 'ada')?.fix).toBe('settings');
    expect(mailRefusal('about:blank', 'ada')).toBeNull();
  });
});

describe('what a failed mail send shows', () => {
  const hrefs = { profile: '/p', email: '/e', settings: '/s' };
  const rejected = (errors: { path: string; message: string }[]) => refusal(400, { errors });

  it('shows the outcome alone when it is not a rejected actions mail', () => {
    const out = mailFailure(
      'reset',
      rejected([{ path: 'actions', message: 'none' }]),
      'ada',
      hrefs,
    );
    expect(out.errors).toBeNull();
    expect(out.outcome?.text).toMatch(/^Not sent: /u);
  });

  it('shows the field error alone when it explains the whole refusal', () => {
    expect(
      mailFailure('actions', rejected([{ path: 'actions', message: 'none' }]), 'ada', hrefs),
    ).toEqual({ errors: { actions: 'none' }, outcome: null });
  });

  it('shows both when part of the refusal names no field', () => {
    const out = mailFailure(
      'actions',
      rejected([
        { path: 'actions', message: 'none' },
        { path: 'elsewhere', message: 'odd' },
      ]),
      'ada',
      hrefs,
    );
    expect(out.errors).toEqual({ actions: 'none' });
    expect(out.outcome).not.toBeNull();
  });
});

describe('mail outcomes', () => {
  const hrefs = { profile: '/p', email: '/e', settings: '/s' };

  it('says a lost answer, an unreadable one and a console fault, none with a fix', () => {
    expect(mailOutcome(failure('network'), 'ada', hrefs)).toMatchObject({ sent: false, fix: null });
    expect(mailOutcome(failure('schema'), 'ada', hrefs)).toEqual({
      sent: true,
      text: 'The mail was asked for, but the answer could not be read.',
      fix: null,
    });
    expect(mailOutcome(failure('defect'), 'ada', hrefs).text).toBe(
      'The console could not finish. This is a fault in the console, not something you did.',
    );
  });

  it('points a refusal that is a fact about the tenant or subject at where it is put right', () => {
    expect(mailOutcome(refusal(409, { type: 'about:blank#no-email' }), 'ada', hrefs)).toEqual({
      sent: false,
      text: 'ada has no email address. Add one under Profile first.',
      fix: { label: 'Profile', href: '/p' },
    });
    expect(
      mailOutcome(refusal(409, { type: 'about:blank#no-mail-relay' }), 'ada', hrefs).fix,
    ).toEqual({
      label: 'Email',
      href: '/e',
    });
    expect(
      mailOutcome(refusal(409, { type: 'about:blank#reset-password-off' }), 'ada', hrefs).fix,
    ).toEqual({
      label: 'Settings',
      href: '/s',
    });
  });

  it('words any other refusal without a fix', () => {
    expect(mailOutcome(refusal(403), 'ada', hrefs).text).toBe(
      'Refused: it needs the manage-users capability, or ada holds an admin capability you do not.',
    );
    expect(mailOutcome(refusal(500, { detail: 'boom' }), 'ada', hrefs)).toEqual({
      sent: false,
      text: 'Not sent: boom',
      fix: null,
    });
    expect(mailOutcome(refusal(500), 'ada', hrefs).text).toBe('Not sent: T500');
  });

  it('places a 400 under the actions field for the actions mail only', () => {
    const rejected = refusal(400, { errors: [{ path: 'actions', message: 'none' }] });
    expect(mailFieldErrors('actions', rejected)).toEqual({
      fields: { actions: 'none' },
      other: [],
    });
    expect(mailFieldErrors('reset', rejected)).toBeNull();
    expect(mailFieldErrors('actions', refusal(403))).toBeNull();
    expect(mailFieldErrors('actions', failure('network'))).toBeNull();
  });

  it('says what was sent, and to whom', () => {
    expect(mailSentText('reset', 'a@x.test')).toBe('A password reset link was sent to a@x.test.');
    expect(mailSentText('verification', null)).toBe(
      'A verification link was sent to their address.',
    );
    expect(mailSentText('actions', 'a@x.test', 1)).toBe(
      'A link through 1 action was sent to a@x.test. Following it asks for each, in order.',
    );
    expect(mailSentText('actions', 'a@x.test', 3)).toMatch(/^A link through 3 actions was sent/u);
  });

  it('wants at least one action for the actions mail', () => {
    expect(actionsMailProblem([])).toEqual({ actions: 'Choose at least one action.' });
    expect(actionsMailProblem(['update-password'])).toBeNull();
  });
});
