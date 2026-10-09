import { describe, expect, it } from 'vitest';
import type { GatewayFailure } from '#/shared/service/result.ts';
import {
  changeFailureText,
  accessRefusal,
  removalConfirmation,
} from '#/features/subjects/service/access.ts';

const failure = (kind: 'network' | 'schema' | 'defect'): GatewayFailure => ({ ok: false, kind });

const refusal = (
  status: number,
  extra: { type?: string; detail?: string; errors?: { path: string; message: string }[] } = {},
): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: `T${String(status)}`, status, ...extra },
});

describe('a change to what a subject holds, refused', () => {
  const problem = (status: number, type = 'about:blank') => ({ type, title: 'x', status });

  it('says the ceiling a 403 met, in the words of what was changed', () => {
    expect(accessRefusal('ada', 'groups')(problem(403))).toMatch(
      /a group's roles are granted with it/u,
    );
    expect(accessRefusal('ada', 'roles')(problem(403))).toMatch(/only what you hold yourself/u);
  });

  it('words the last-administrator guard in place', () => {
    expect(accessRefusal('ada', 'roles')(problem(409, 'about:blank#last-administrator'))).toBe(
      'ada is the last enabled administrator here, and this would take that away, so nothing was changed. Make somebody else an administrator first.',
    );
    expect(accessRefusal('ada', 'roles')(problem(409))).toBeNull();
  });
});

describe('the last-administrator guard, worded in place', () => {
  it("keeps the API's detail, and says so of yourself", () => {
    const problem = {
      type: 'about:blank#last-administrator',
      status: 409,
      detail: 'this would leave no enabled subject holding tenant-admin',
    };
    expect(accessRefusal('ada', 'roles', true)(problem)).toBe(
      'You are the last enabled administrator here, and this would take that away, so nothing was changed (this would leave no enabled subject holding tenant-admin). Make somebody else an administrator first.',
    );
  });
});

describe('what is asked before a save takes capabilities away', () => {
  it('asks nothing of a change to somebody else that leaves every tenant alone', () => {
    expect(
      removalConfirmation({
        name: 'ada',
        self: false,
        removed: ['view-audit'],
        removesTenants: false,
      }),
    ).toBeNull();
    expect(
      removalConfirmation({ name: 'ada', self: true, removed: [], removesTenants: false }),
    ).toBeNull();
  });

  it('says what this console stops offering when you take from yourself', () => {
    expect(
      removalConfirmation({
        name: 'ada',
        self: true,
        removed: ['view-audit'],
        removesTenants: false,
      }),
    ).toEqual({
      title: 'Remove your own admin capabilities?',
      consequence:
        'You are taking view-audit from yourself. Once it lands this console stops offering reading the audit trail, unless a group or another role still gives it to you, and you cannot give it back yourself.',
      typed: null,
    });
  });

  it('asks for the name, typed, before manage-tenants is taken from anybody', () => {
    const asked = removalConfirmation({
      name: 'ada',
      self: false,
      removed: ['tenant-admin'],
      removesTenants: true,
    });
    expect(asked?.title).toBe('Take system administration from ada?');
    expect(asked?.typed).toBe('ada');
    expect(
      removalConfirmation({
        name: 'ada',
        self: true,
        removed: ['manage-tenants'],
        removesTenants: true,
      })?.title,
    ).toBe('Revoke your own system administration?');
  });
});

describe('what a confirmed change says when it fails', () => {
  it('words each way a change can end, and a missing subject as already gone', () => {
    expect(changeFailureText(failure('network'), 'manage-users')).toBe(
      'Could not confirm the result. Nothing was sent again; the tab shows what the server holds now.',
    );
    expect(changeFailureText(failure('schema'), 'manage-users')).toBe(
      'It may have happened, but the answer could not be read. The tab shows what the server holds now.',
    );
    expect(changeFailureText(failure('defect'), 'manage-users')).toBe(
      'The console could not finish. This is a fault in the console, not something you did.',
    );
    expect(changeFailureText(refusal(403), 'manage-sessions')).toBe(
      'Refused: it needs the manage-sessions capability, or the subject holds an admin capability you do not.',
    );
    expect(changeFailureText(refusal(404), 'manage-users')).toBe('It is already gone.');
    expect(changeFailureText(refusal(500, { detail: 'boom' }), 'manage-users')).toBe(
      'Refused: boom',
    );
    expect(changeFailureText(refusal(500), 'manage-users')).toBe('Refused: T500');
  });
});
