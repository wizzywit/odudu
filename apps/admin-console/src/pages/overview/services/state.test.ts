import type { Settings } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { attentionState, isClear, withRetry } from '#/pages/overview/services/state';
import {
  OFF,
  LOADING,
  ready,
  authority,
  areaOf,
  reads,
  KEYS,
  SMTP_NONE,
  RULES,
  QUIET,
} from '#/testing/overviewFixtures';

describe('the attention state', () => {
  const NOW = new Date('2026-09-02T00:30:00Z');
  const everything = authority('manage-tenant', 'manage-keys', 'manage-clients');
  const settled = reads({
    settings: ready<Settings>({ ...QUIET.settings }),
    smtp: ready(SMTP_NONE),
    keys: ready(KEYS),
    counts: {
      subjects: OFF,
      clients: ready({ count: 3, capped: false }),
      groups: OFF,
      roles: OFF,
      scopes: OFF,
    },
  });

  it('judges registration by the clients max_clients counts, not by every client', () => {
    const token = { ...QUIET.settings, client_registration_policy: 'token', max_clients: 3 };
    const withCounts = (all: number, made: number) =>
      reads({
        ...settled,
        settings: ready<Settings>(token),
        counts: { ...settled.counts, clients: ready({ count: all, capped: false }) },
        operatorClients: ready({ count: made, capped: false }),
      });
    const ids = (r: typeof settled) =>
      attentionState(r, everything, areaOf, NOW, RULES).items.map((item) => item.id);
    expect(ids(withCounts(900, 1))).toEqual([]);
    expect(ids(withCounts(3, 3))).toEqual(['registration']);
  });

  it('is checking until whoami answers or a read it uses is loading', () => {
    expect(attentionState(settled, undefined, areaOf, NOW, RULES).status).toBe('checking');
    const loading = reads({ ...settled, smtp: LOADING });
    expect(attentionState(loading, everything, areaOf, NOW, RULES).status).toBe('checking');
    expect(attentionState(settled, everything, areaOf, NOW, RULES).status).toBe('ready');
  });

  it('links each item to the area that fixes it', () => {
    const noMail = reads({
      ...settled,
      settings: ready<Settings>({ ...QUIET.settings, verify_email: true }),
    });
    const state = attentionState(noMail, everything, areaOf, NOW, RULES);
    expect(state.items).toEqual([
      expect.objectContaining({
        id: 'smtp',
        href: '/console/acme/email',
        linkLabel: 'Open Email',
      }),
    ]);
  });

  it('judges promotion by the clock it is given', () => {
    const early = attentionState(settled, everything, areaOf, NOW, RULES);
    const later = attentionState(
      settled,
      everything,
      areaOf,
      new Date('2026-09-02T01:05:01Z'),
      RULES,
    );
    expect(early.items).toEqual([]);
    expect(later.items.map((i) => i.id)).toEqual(['key:r']);
  });

  it('names the capabilities a check needed that whoami says are missing', () => {
    expect(
      attentionState(settled, authority('manage-tenant'), areaOf, NOW, RULES).unchecked,
    ).toEqual(['manage-keys', 'manage-clients']);
    expect(attentionState(settled, undefined, areaOf, NOW, RULES).unchecked).toEqual([]);
  });

  it('hands back the way to ask again for each failed read it uses', () => {
    const calls: string[] = [];
    const failing = reads({
      ...settled,
      smtp: { status: 'failed', refused: false, retry: () => calls.push('smtp') },
      keys: { status: 'failed', refused: true, retry: () => calls.push('keys') },
      audit: { status: 'failed', refused: false, retry: () => calls.push('audit') },
    });
    const state = attentionState(failing, everything, areaOf, NOW, RULES);
    expect(state.failed).toBe(true);
    for (const again of state.retries) again();
    expect(calls).toEqual(['smtp', 'keys']);
    expect(attentionState(settled, everything, areaOf, NOW, RULES)).toMatchObject({
      failed: false,
      retries: [],
    });
  });

  it('is clear only when it is ready with nothing to say, to check or to retry', () => {
    const state = attentionState(settled, everything, areaOf, NOW, RULES);
    expect(isClear(state)).toBe(true);
    expect(isClear({ ...state, status: 'checking' })).toBe(false);
    expect(isClear({ ...state, failed: true })).toBe(false);
    expect(isClear({ ...state, unchecked: ['manage-keys'] })).toBe(false);
    expect(
      isClear({
        ...state,
        items: [{ id: 'x', area: 'keys', title: '', detail: '', href: '', linkLabel: '' }],
      }),
    ).toBe(false);
  });
});

describe('the one retry of the attention panel', () => {
  it('asks again for every failed read, and has the other fields as they were', () => {
    const calls: string[] = [];
    const data = attentionState(
      reads({
        settings: ready<Settings>({ max_clients: 3 }),
        smtp: { status: 'failed', refused: false, retry: () => calls.push('smtp') },
        keys: { status: 'failed', refused: false, retry: () => calls.push('keys') },
      }),
      authority('manage-tenant', 'manage-keys', 'manage-clients'),
      areaOf,
      new Date('2026-09-02T00:30:00Z'),
      RULES,
    );
    const state = withRetry(data);
    expect(state).not.toHaveProperty('retries');
    expect(state.failed).toBe(true);
    state.retry();
    expect(calls).toEqual(['smtp', 'keys']);
  });
});
