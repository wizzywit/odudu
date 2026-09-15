import { describe, expect, it } from 'vitest';
import { decideReuse } from '#/usecase/session-reuse';

const now = new Date('2026-09-15T12:00:00Z');
const session = { subjectId: 'u1', authTime: new Date('2026-09-15T11:00:00Z') };

describe('decideReuse', () => {
  it('reuses a live session when no prompt constrains it', () => {
    expect(decideReuse({ session, prompts: new Set(), maxAge: null, now })).toEqual({
      kind: 'reuse',
      subjectId: 'u1',
      authTime: session.authTime,
    });
  });

  it('reuses under prompt=none, which is the whole point of prompt=none', () => {
    expect(decideReuse({ session, prompts: new Set(['none']), maxAge: null, now }).kind).toBe(
      'reuse',
    );
  });

  it('refuses prompt=none with no session', () => {
    expect(decideReuse({ session: null, prompts: new Set(['none']), maxAge: null, now })).toEqual({
      kind: 'refuse',
      error: 'login_required',
    });
  });

  it('authenticates afresh under prompt=login even with a live session', () => {
    expect(decideReuse({ session, prompts: new Set(['login']), maxAge: null, now }).kind).toBe(
      'authenticate',
    );
  });

  it('refuses prompt=none and prompt=login together rather than choosing one', () => {
    expect(
      decideReuse({ session, prompts: new Set(['none', 'login']), maxAge: null, now }),
    ).toEqual({ kind: 'refuse', error: 'login_required' });
  });

  it('reuses when the session is younger than max_age', () => {
    expect(decideReuse({ session, prompts: new Set(), maxAge: 7200, now }).kind).toBe('reuse');
  });

  it('reauthenticates when max_age is exceeded', () => {
    expect(decideReuse({ session, prompts: new Set(), maxAge: 1800, now }).kind).toBe(
      'authenticate',
    );
  });

  it('refuses when max_age is exceeded and prompt=none forbids the page', () => {
    expect(decideReuse({ session, prompts: new Set(['none']), maxAge: 1800, now })).toEqual({
      kind: 'refuse',
      error: 'login_required',
    });
  });

  it('treats max_age=0 as a demand to reauthenticate now', () => {
    expect(decideReuse({ session, prompts: new Set(), maxAge: 0, now }).kind).toBe('authenticate');
  });
});
