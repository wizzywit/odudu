import { describe, expect, it } from 'vitest';
import { grantedText, grantFailureText } from '#/features/system-admins/service/grant.ts';

describe('a grant', () => {
  const problem = (status: number, extra: object = {}) =>
    ({
      failure: {
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Title', status, ...extra },
      },
      request: 'set-roles',
    }) as const;

  it('says what it gave, by label', () => {
    expect(grantedText('ada', ['tenant-admin'])).toBe(
      'ada now holds Full (tenant-admin) in system.',
    );
    expect(grantedText('ada', ['view-audit', 'manage-users'])).toBe(
      'ada now holds view-audit, manage-users in system.',
    );
  });

  it('words each way it fails', () => {
    expect(
      grantFailureText('ada', { failure: { ok: false, kind: 'network' }, request: 'roles' }),
    ).toBe('Could not confirm whether ada was given it. Check the list before trying again.');
    expect(
      grantFailureText('ada', { failure: { ok: false, kind: 'schema' }, request: 'roles' }),
    ).toBe('ada may have been given it, but the answer could not be read. Check the list.');
    expect(
      grantFailureText('ada', { failure: { ok: false, kind: 'defect' }, request: 'roles' }),
    ).toBe(
      'The console could not finish, so ada was not given it. This is a fault in the console, not something you did.',
    );
    expect(grantFailureText('ada', problem(403))).toBe(
      'ada was not given it: it needs the manage-users capability.',
    );
    expect(grantFailureText('ada', problem(403, { detail: 'the caller does not hold: x' }))).toBe(
      'ada was not given it: the caller does not hold: x.',
    );
    expect(grantFailureText('ada', problem(412))).toBe(
      'ada was not given it: their roles changed while this ran. Try again.',
    );
    expect(grantFailureText('ada', problem(409, { detail: 'last administrator' }))).toBe(
      'ada was not given it: last administrator.',
    );
    expect(grantFailureText('ada', problem(500))).toBe('ada was not given it: Title.');
  });
});
