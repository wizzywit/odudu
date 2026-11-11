import type { CredentialSummary, UserRecord } from '@odudu/domain-identity';
import type { SubjectConsent } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';
import type { MeReads, Page } from '#/repository/reads';
import type { MeSessionRecord } from '#/service/session-view';
import { encodeCursor } from '#/service/cursor';
import {
  listConsents,
  listCredentials,
  listSessions,
  readProfile,
  type MeCaller,
} from '#/usecase/reads';

const ID_A = '01a0a992-4657-7d89-8fbf-3385f54810d1';
const ID_B = '01a0a992-4657-7d89-8fbf-3385f54810d2';
const ID_C = '01a0a992-4657-7d89-8fbf-3385f54810d3';
const AT = new Date('2026-01-01T00:00:00Z');
const NOW = new Date('2026-11-11T10:00:00Z');

const CALLER: MeCaller = {
  tenantId: 'tenant-1',
  subjectId: 'subject-1',
  sessionId: ID_B,
  lifespans: {
    ssoSessionIdleSeconds: 1800,
    ssoSessionMaxSeconds: 36_000,
    rememberMeIdleSeconds: 604_800,
    rememberMeMaxSeconds: 2_592_000,
  },
};

interface Seen {
  tenantId?: string;
  subjectId?: string;
  page?: Page;
}

function reads(seen: Seen, over: Partial<MeReads> = {}): MeReads {
  const note = (tenantId: string, subjectId: string, page?: Page) => {
    seen.tenantId = tenantId;
    seen.subjectId = subjectId;
    if (page !== undefined) seen.page = page;
  };
  return {
    profile: (t, s) => {
      note(t, s);
      return Promise.resolve(null);
    },
    credentials: (t, s, page) => {
      note(t, s, page);
      return Promise.resolve({ rows: [], recoveryCodesLeft: 0 });
    },
    sessions: (t, s, _lifespans, _now, page) => {
      note(t, s, page);
      return Promise.resolve([]);
    },
    consents: (t, s, page) => {
      note(t, s, page);
      return Promise.resolve([]);
    },
    ...over,
  };
}

const session = (id: string): MeSessionRecord => ({
  id,
  createdAt: AT,
  lastActiveAt: AT,
  expiresAt: AT,
  remembered: false,
});

describe('readProfile', () => {
  it('reads by the caller’s own tenant and subject', async () => {
    const seen: Seen = {};
    const outcome = await readProfile({ reads: reads(seen), now: () => NOW }, CALLER);
    expect(outcome).toEqual({ kind: 'not_found' });
    expect(seen).toMatchObject({ tenantId: 'tenant-1', subjectId: 'subject-1' });
  });

  it('returns the profile the store holds', async () => {
    const user = { subjectId: 'subject-1', username: 'ada' } as UserRecord;
    const outcome = await readProfile(
      { reads: reads({}, { profile: () => Promise.resolve(user) }), now: () => NOW },
      CALLER,
    );
    expect(outcome).toEqual({ kind: 'ok', profile: user });
  });
});

describe('listSessions', () => {
  it('asks for one row past the limit, and returns a cursor when it came back', async () => {
    const seen: Seen = {};
    const store = reads(seen, {
      sessions: (_t, _s, _l, _n, page) => {
        seen.page = page;
        return Promise.resolve([session(ID_A), session(ID_B), session(ID_C)]);
      },
    });
    const outcome = await listSessions({ reads: store, now: () => NOW }, CALLER, { limit: 2 });
    expect(seen.page).toEqual({ after: undefined, limit: 3 });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.items.map((s) => s.id)).toEqual([ID_A, ID_B]);
    expect(outcome.items.map((s) => s.current)).toEqual([false, true]);
    expect(outcome.next).toBe(encodeCursor('sessions', ID_B));
  });

  it('returns no cursor on the last page', async () => {
    const store = reads({}, { sessions: () => Promise.resolve([session(ID_A)]) });
    const outcome = await listSessions({ reads: store, now: () => NOW }, CALLER, { limit: 2 });
    expect(outcome).toMatchObject({ kind: 'ok', next: null });
  });

  it('continues after the id a cursor names', async () => {
    const seen: Seen = {};
    await listSessions({ reads: reads(seen), now: () => NOW }, CALLER, {
      cursor: encodeCursor('sessions', ID_A),
    });
    expect(seen.page?.after).toBe(ID_A);
  });

  it('refuses a cursor of another list without reading', async () => {
    const seen: Seen = {};
    const outcome = await listSessions({ reads: reads(seen), now: () => NOW }, CALLER, {
      cursor: encodeCursor('credentials', ID_A),
    });
    expect(outcome).toEqual({ kind: 'invalid_cursor' });
    expect(seen.subjectId).toBeUndefined();
  });
});

describe('listCredentials', () => {
  const row = (id: string, type: CredentialSummary['type']): CredentialSummary => ({
    id,
    type,
    label: null,
    createdAt: AT,
    lastUsedAt: null,
  });

  it('carries the count of recovery codes left', async () => {
    const store = reads(
      {},
      {
        credentials: () => Promise.resolve({ rows: [row(ID_A, 'totp')], recoveryCodesLeft: 4 }),
      },
    );
    const outcome = await listCredentials({ reads: store, now: () => NOW }, CALLER, {});
    expect(outcome).toMatchObject({ kind: 'ok', recoveryCodesLeft: 4 });
    if (outcome.kind === 'ok') expect(outcome.items.map((c) => c.type)).toEqual(['totp']);
  });

  it('does not return a row of a kind a person is not shown', async () => {
    const store = reads(
      {},
      {
        credentials: () =>
          Promise.resolve({
            rows: [row(ID_A, 'recovery-code'), row(ID_B, 'password')],
            recoveryCodesLeft: 0,
          }),
      },
    );
    const outcome = await listCredentials({ reads: store, now: () => NOW }, CALLER, {});
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.items.map((c) => c.type)).toEqual(['password']);
  });
});

describe('listConsents', () => {
  const consent = (clientKey: string): SubjectConsent => ({
    clientId: 'row-id',
    clientKey,
    scopeNames: ['openid'],
    grantedAt: AT,
  });

  it('pages by the application’s client_id', async () => {
    const store = reads(
      {},
      { consents: () => Promise.resolve([consent('a'), consent('b'), consent('c')]) },
    );
    const outcome = await listConsents({ reads: store, now: () => NOW }, CALLER, { limit: 2 });
    expect(outcome).toMatchObject({ kind: 'ok', next: encodeCursor('consents', 'b') });
  });
});
