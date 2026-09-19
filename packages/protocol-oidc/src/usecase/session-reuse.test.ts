import { describe, expect, it } from 'vitest';
import { decideReuse } from '#/usecase/session-reuse';
import { type PromptValue } from '#/service/prompt';

const now = new Date('2026-09-19T10:30:30Z');
const alice = { id: 's1', subjectId: 'alice', authTime: new Date('2026-09-19T10:00:00Z') };
const bob = { id: 's2', subjectId: 'bob', authTime: new Date('2026-09-19T10:30:00Z') };
const stale = { id: 's3', subjectId: 'carol', authTime: new Date('2026-09-19T10:00:00Z') };

describe('decideReuse over a set', () => {
  it('reuses the only live session', () => {
    expect(decideReuse({ sessions: [alice], prompts: new Set(), maxAge: null, now })).toEqual({
      kind: 'reuse',
      sessionId: 's1',
      subjectId: 'alice',
      authTime: alice.authTime,
    });
  });

  it('asks which account when more than one is live, with no prompt at all', () => {
    const decision = decideReuse({
      sessions: [alice, bob],
      prompts: new Set(),
      maxAge: null,
      now,
    });
    expect(decision).toEqual({ kind: 'select', candidates: [alice, bob] });
  });

  it('asks which account for prompt=select_account even with one live session', () => {
    const prompts = new Set<PromptValue>(['select_account']);
    expect(decideReuse({ sessions: [alice], prompts, maxAge: null, now }).kind).toBe('select');
  });

  it('refuses under prompt=none when selection would be required', () => {
    const prompts = new Set<PromptValue>(['none']);
    expect(decideReuse({ sessions: [alice, bob], prompts, maxAge: null, now })).toEqual({
      kind: 'refuse',
      error: 'account_selection_required',
    });
  });

  it('refuses login_required under prompt=none with no session', () => {
    const prompts = new Set<PromptValue>(['none']);
    expect(decideReuse({ sessions: [], prompts, maxAge: null, now })).toEqual({
      kind: 'refuse',
      error: 'login_required',
    });
  });

  it('drops a session past max_age from the candidates rather than refusing outright', () => {
    const decision = decideReuse({ sessions: [stale, bob], prompts: new Set(), maxAge: 60, now });
    expect(decision).toEqual({
      kind: 'reuse',
      sessionId: 's2',
      subjectId: 'bob',
      authTime: bob.authTime,
    });
  });

  it('authenticates when prompt=login, whatever is live', () => {
    const prompts = new Set<PromptValue>(['login']);
    expect(decideReuse({ sessions: [alice, bob], prompts, maxAge: null, now }).kind).toBe(
      'authenticate',
    );
  });
});
