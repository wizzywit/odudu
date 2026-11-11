import type { CredentialSummary, UserRecord } from '@odudu/domain-identity';
import { describe, expect, it } from 'vitest';
import type { MeWrites, MeWriteTx } from '#/repository/writes';
import type { MeAuditEvent } from '#/service/audit';
import { UsernameTakenError } from '#/service/errors';
import { SESSION_END_LIMIT } from '#/service/session-end';
import type { MeCaller } from '#/usecase/admit-me';
import {
  amendProfile,
  endOtherSessions,
  endSession,
  renameCredential,
  revokeConsent,
  type MeWriteDeps,
} from '#/usecase/writes';

const SESSION = '01a0a992-4657-7d89-8fbf-3385f54810d1';
const OTHER = '01a0a992-4657-7d89-8fbf-3385f54810d2';
const CRED = '01a0a992-4657-7d89-8fbf-3385f54810d3';
const NOW = new Date('2026-11-11T10:00:00Z');

const CALLER: MeCaller = {
  tenantId: 'tenant-1',
  subjectId: 'subject-1',
  sessionId: SESSION,
  clientId: 'app',
  issuer: 'https://id.example.com/tenants/acme',
  freshnessSeconds: 300,
  usernameEditable: true,
  lifespans: {
    ssoSessionIdleSeconds: 1800,
    ssoSessionMaxSeconds: 36_000,
    rememberMeIdleSeconds: 604_800,
    rememberMeMaxSeconds: 2_592_000,
  },
};

const USER = {
  subjectId: 'subject-1',
  username: 'ada',
  name: 'Ada',
  phoneNumber: '+2348012345678',
  phoneNumberVerified: true,
} as UserRecord;

const SUMMARY: CredentialSummary = {
  id: CRED,
  type: 'totp',
  label: 'Phone',
  createdAt: NOW,
  lastUsedAt: null,
};

interface Log {
  calls: string[];
  audits: MeAuditEvent[];
  tenants: string[];
}

function world(over: Partial<MeWriteTx> = {}): { deps: MeWriteDeps; log: Log } {
  const log: Log = { calls: [], audits: [], tenants: [] };
  const tx: MeWriteTx = {
    lockProfile: (s) => {
      log.calls.push(`lockProfile ${s}`);
      return Promise.resolve(USER);
    },
    updateProfile: (s, patch) => {
      log.calls.push(`updateProfile ${s} ${JSON.stringify(patch)}`);
      return Promise.resolve({ ...USER, ...patch });
    },
    renameUser: (s, username) => {
      log.calls.push(`renameUser ${s} ${username}`);
      return Promise.resolve({ ...USER, username });
    },
    setVerification: (s, patch) => {
      log.calls.push(`setVerification ${s} ${JSON.stringify(patch)}`);
      return Promise.resolve(USER);
    },
    lockOwnedSession: (s, id) => {
      log.calls.push(`lockOwnedSession ${s} ${id}`);
      return Promise.resolve(true);
    },
    liveSessionIds: (s, _n, limit, except) => {
      log.calls.push(`liveSessionIds ${s} ${String(limit)} ${String(except)}`);
      return Promise.resolve([OTHER]);
    },
    endSessions: (input) => {
      log.calls.push(
        `endSessions ${input.subjectId} ${input.sessionIds.join(',')} ${input.issuer}`,
      );
      return Promise.resolve();
    },
    revokeConsent: (s, key) => {
      log.calls.push(`revokeConsent ${s} ${key}`);
      return Promise.resolve({ scopeNames: ['openid'], grantsRevoked: 2 });
    },
    renameCredential: (s, id, label) => {
      log.calls.push(`renameCredential ${s} ${id} ${label}`);
      return Promise.resolve({ ...SUMMARY, label });
    },
    audit: (event) => {
      log.audits.push(event);
      return Promise.resolve();
    },
    ...over,
  };
  const writes: MeWrites = {
    transact: (tenantId, run) => {
      log.tenants.push(tenantId);
      return run(tx);
    },
  };
  return { deps: { writes, now: () => NOW }, log };
}

describe('amendProfile', () => {
  it('writes the changed claims in the caller’s tenant and files one audit row', async () => {
    const { deps, log } = world();
    const outcome = await amendProfile(deps, CALLER, { name: 'Ada L' });
    expect(outcome).toMatchObject({ kind: 'ok', profile: { name: 'Ada L' } });
    expect(log.tenants).toEqual(['tenant-1']);
    expect(log.calls).toEqual([
      'lockProfile subject-1',
      'updateProfile subject-1 {"name":"Ada L"}',
    ]);
    expect(log.audits).toHaveLength(1);
    expect(log.audits[0]).toMatchObject({
      action: 'subject.profile_amend',
      actorSubjectId: 'subject-1',
      actorClientKey: 'app',
      detail: { via: 'me', fields: ['name'] },
    });
  });

  it('drops a phone number’s verification before the number changes', async () => {
    const { deps, log } = world();
    await amendProfile(deps, CALLER, { phone_number: '+2348099999999' });
    expect(log.calls.slice(1)).toEqual([
      'setVerification subject-1 {"phoneNumberVerified":false}',
      'updateProfile subject-1 {"phoneNumber":"+2348099999999"}',
    ]);
  });

  it('writes and records nothing when nothing changes', async () => {
    const { deps, log } = world();
    expect(await amendProfile(deps, CALLER, { name: 'Ada' })).toMatchObject({ kind: 'ok' });
    expect(log.calls).toEqual(['lockProfile subject-1']);
    expect(log.audits).toEqual([]);
  });

  it('refuses a value of the wrong shape without writing', async () => {
    const { deps, log } = world();
    expect(await amendProfile(deps, CALLER, { birthdate: 'soon' })).toMatchObject({
      kind: 'invalid_value',
      field: 'birthdate',
    });
    expect(log.calls).toEqual(['lockProfile subject-1']);
    expect(log.audits).toEqual([]);
  });

  it('renames the user after the claims and files the field, not the name', async () => {
    const { deps, log } = world();
    const outcome = await amendProfile(deps, CALLER, { username: 'ada2', name: 'Ada L' });
    expect(outcome).toMatchObject({ kind: 'ok', profile: { name: 'Ada L' } });
    expect(log.calls).toEqual([
      'lockProfile subject-1',
      'renameUser subject-1 ada2',
      'updateProfile subject-1 {"name":"Ada L"}',
    ]);
    expect(log.audits[0]?.detail).toEqual({ via: 'me', fields: ['username', 'name'] });
  });

  it('writes only the rename when that is all that changes', async () => {
    const { deps, log } = world();
    await amendProfile(deps, CALLER, { username: 'ada2' });
    expect(log.calls).toEqual(['lockProfile subject-1', 'renameUser subject-1 ada2']);
  });

  it('answers username_taken when another subject holds the name', async () => {
    const { deps, log } = world({
      renameUser: () => Promise.reject(new UsernameTakenError()),
    });
    expect(await amendProfile(deps, CALLER, { username: 'grace' })).toEqual({
      kind: 'username_taken',
    });
    expect(log.audits).toEqual([]);
  });

  it('answers not_found for a subject with no profile', async () => {
    const { deps, log } = world({ lockProfile: () => Promise.resolve(null) });
    expect(await amendProfile(deps, CALLER, { name: 'x' })).toEqual({ kind: 'not_found' });
    expect(log.audits).toEqual([]);
  });
});

describe('endSession', () => {
  it('ends another session of the person and files its row', async () => {
    const { deps, log } = world();
    expect(await endSession(deps, CALLER, OTHER)).toEqual({
      kind: 'ended',
      currentSessionEnded: false,
    });
    expect(log.calls).toEqual([
      `lockOwnedSession subject-1 ${OTHER}`,
      `endSessions subject-1 ${OTHER} ${CALLER.issuer}`,
    ]);
    expect(log.audits[0]).toMatchObject({
      action: 'session.end',
      resourceType: 'session',
      resourceId: OTHER,
      detail: { via: 'me', current: false },
    });
  });

  it('says so when the session ended is the token’s own', async () => {
    const { deps, log } = world();
    expect(await endSession(deps, CALLER, SESSION)).toEqual({
      kind: 'ended',
      currentSessionEnded: true,
    });
    expect(log.audits[0]?.detail).toMatchObject({ current: true });
  });

  it('answers not_found for a session the person does not own', async () => {
    const { deps, log } = world({ lockOwnedSession: () => Promise.resolve(false) });
    expect(await endSession(deps, CALLER, OTHER)).toEqual({ kind: 'not_found' });
    expect(log.calls).toEqual([]);
    expect(log.audits).toEqual([]);
  });

  it('answers not_found for an id that is not a uuid without asking the store', async () => {
    const { deps, log } = world();
    expect(await endSession(deps, CALLER, 'not-a-uuid')).toEqual({ kind: 'not_found' });
    expect(log.tenants).toEqual([]);
  });
});

describe('endOtherSessions', () => {
  it('ends the others, never the token’s own, one past the bound to learn if more remain', async () => {
    const { deps, log } = world();
    expect(await endOtherSessions(deps, CALLER)).toEqual({ kind: 'ended', ended: 1, more: false });
    expect(log.calls).toEqual([
      `liveSessionIds subject-1 ${String(SESSION_END_LIMIT + 1)} ${SESSION}`,
      `endSessions subject-1 ${OTHER} ${CALLER.issuer}`,
    ]);
    expect(log.audits[0]).toMatchObject({
      action: 'session.end_all',
      detail: { via: 'me', ended: 1, more: false },
    });
  });

  it('ends a bounded number and says more remain', async () => {
    const ids = Array.from({ length: SESSION_END_LIMIT + 1 }, (_, i) => `id-${String(i)}`);
    const { deps, log } = world({ liveSessionIds: () => Promise.resolve(ids) });
    const outcome = await endOtherSessions(deps, CALLER);
    expect(outcome).toEqual({ kind: 'ended', ended: SESSION_END_LIMIT, more: true });
    expect(log.calls[0]).toBe(
      `endSessions subject-1 ${ids.slice(0, SESSION_END_LIMIT).join(',')} ${CALLER.issuer}`,
    );
  });

  it('with a token that has no session, leaves out none', async () => {
    const { deps, log } = world();
    await endOtherSessions(deps, { ...CALLER, sessionId: null });
    expect(log.calls[0]).toBe(`liveSessionIds subject-1 ${String(SESSION_END_LIMIT + 1)} null`);
  });

  it('ends and records nothing when there is no other session', async () => {
    const { deps, log } = world({ liveSessionIds: () => Promise.resolve([]) });
    expect(await endOtherSessions(deps, CALLER)).toEqual({ kind: 'ended', ended: 0, more: false });
    expect(log.calls).toEqual([]);
    expect(log.audits).toEqual([]);
  });
});

describe('revokeConsent', () => {
  it('withdraws the consent and files what it granted', async () => {
    const { deps, log } = world();
    expect(await revokeConsent(deps, CALLER, 'portal')).toEqual({ kind: 'revoked' });
    expect(log.calls).toEqual(['revokeConsent subject-1 portal']);
    expect(log.audits[0]).toMatchObject({
      action: 'consent.revoke',
      detail: { via: 'me', client_id: 'portal', scope_names: ['openid'], grants_revoked: 2 },
    });
  });

  it('answers not_found where the person gave no consent', async () => {
    const { deps, log } = world({ revokeConsent: () => Promise.resolve(null) });
    expect(await revokeConsent(deps, CALLER, 'portal')).toEqual({ kind: 'not_found' });
    expect(log.audits).toEqual([]);
  });
});

describe('renameCredential', () => {
  it('relabels the authenticator and files the change without the label', async () => {
    const { deps, log } = world();
    expect(await renameCredential(deps, CALLER, CRED, 'Work phone')).toEqual({
      kind: 'renamed',
      credential: {
        id: CRED,
        type: 'totp',
        label: 'Work phone',
        createdAt: NOW,
        lastUsedAt: null,
      },
    });
    expect(log.calls).toEqual([`renameCredential subject-1 ${CRED} Work phone`]);
    expect(JSON.stringify(log.audits)).not.toContain('Work phone');
    expect(log.audits[0]).toMatchObject({
      action: 'subject.credential_rename',
      detail: { via: 'me', credential_id: CRED, type: 'totp' },
    });
  });

  it('answers not_found for no such authenticator and for an id that is not a uuid', async () => {
    const { deps, log } = world({ renameCredential: () => Promise.resolve(null) });
    expect(await renameCredential(deps, CALLER, CRED, 'x')).toEqual({ kind: 'not_found' });
    expect(await renameCredential(deps, CALLER, 'nope', 'x')).toEqual({ kind: 'not_found' });
    expect(log.audits).toEqual([]);
  });
});
