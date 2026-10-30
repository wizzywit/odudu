import { MESSAGE_OVERRIDE_KEY_MAX_LENGTH, MESSAGE_OVERRIDE_LIMIT } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  ALREADY_REMOVED,
  afterSave,
  capText,
  EMPTY_OVERRIDE,
  OVERRIDE_KEY_LENGTH,
  overrideAttempt,
  OVER_BOUND,
  overrideFailure,
  overrideProblems,
  OVERRIDE_CAP,
  removeOutcome,
  saveOutcome,
  UNKNOWN_KEY,
} from '#/features/branding/service';
import type { GatewayFailure } from '#/shared/service/result';

const refused = (status: number, type: string, extra: object = {}): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type, status, title: 'Refused', ...extra },
});

describe('a refused override', () => {
  it('says a key the catalogue does not hold is unknown, in the console’s words', () => {
    const outcome = overrideFailure(
      refused(400, 'about:blank', {
        errors: [{ path: 'key', message: 'is not the key of any page or mail message' }],
      }),
    );
    expect(outcome.errors).toEqual({ key: UNKNOWN_KEY });
    expect(outcome.message).toBeNull();
  });

  it('says the tenant is full, with the cap it is held to', () => {
    const outcome = overrideFailure(refused(409, 'about:blank#message-overrides-full'));
    expect(outcome.message).toBe(OVER_BOUND);
    expect(OVER_BOUND).toContain(String(MESSAGE_OVERRIDE_LIMIT));
    expect(OVERRIDE_CAP).toBe(MESSAGE_OVERRIDE_LIMIT);
  });

  it('puts a refused text under the text', () => {
    const outcome = overrideFailure(
      refused(400, 'about:blank', {
        errors: [{ path: 'message', message: 'is not a valid message' }],
      }),
    );
    expect(outcome.errors.message).toBe('is not a valid message');
  });

  it('names the capability for a 403 and reports it', () => {
    const outcome = overrideFailure(
      refused(403, 'about:blank', { detail: 'the caller does not hold: manage-tenant' }),
    );
    expect(outcome.report).toBe(true);
    expect(outcome.message).toContain('manage-tenant');
  });

  it('never claims what a lost answer did', () => {
    expect(overrideFailure({ ok: false, kind: 'network' }).message).toMatch(/Could not confirm/u);
  });
});

describe('the form', () => {
  it('needs a key and a text, within the server’s bounds', () => {
    expect(overrideProblems(EMPTY_OVERRIDE)).toEqual({
      key: expect.stringContaining('key') as string,
      message: expect.stringContaining('text') as string,
    });
    expect(overrideProblems({ key: 'login.title', message: 'x', etag: null })).toEqual({});
    expect(OVERRIDE_KEY_LENGTH).toBe(MESSAGE_OVERRIDE_KEY_MAX_LENGTH);
    expect(
      overrideProblems({ key: 'k'.repeat(OVERRIDE_KEY_LENGTH + 1), message: 'x', etag: null }).key,
    ).toContain(String(OVERRIDE_KEY_LENGTH));
    expect(overrideProblems({ key: 'k', message: 'x'.repeat(2001), etag: null }).message).toMatch(
      /2000/u,
    );
  });

  it('empties once saved, and is as it was when refused', () => {
    const values = { key: 'login.title', message: 'Hello', etag: null };
    const saved = saveOutcome(
      { ok: true, status: 200, data: {}, etag: null, next: null },
      { locale: 'en', key: 'login.title' },
      values,
    );
    expect(saved.values).toEqual(EMPTY_OVERRIDE);
    expect(saved.toast).toContain('login.title');
    const failed = saveOutcome(
      { ok: false, kind: 'network' },
      { locale: 'en', key: 'login.title' },
      values,
    );
    expect(failed.values).toBe(values);
    expect(failed.toast).toBeNull();
  });
});

describe('removing an override', () => {
  it('counts one that is already gone as done', () => {
    const outcome = removeOutcome(refused(404, 'about:blank'));
    expect(outcome).toEqual({ done: true, text: ALREADY_REMOVED });
  });
});

describe('the count above the table', () => {
  it('is a total only once nothing is left to load', () => {
    expect(capText(1, false)).toContain('1 override in this language');
    expect(capText(50, true)).toContain('50 overrides loaded so far; more follow');
    expect(capText(50, true)).not.toContain('in this language');
  });
});

describe('the form as it is sent', () => {
  it('trims the key, and is not sent while it has problems', () => {
    expect(
      overrideAttempt('en', { key: ' login.title ', message: 'Hi', etag: '"v1"' }).sent,
    ).toEqual({ locale: 'en', key: 'login.title', message: 'Hi', etag: '"v1"' });
    const held = overrideAttempt('en', EMPTY_OVERRIDE);
    expect(held.sent).toBeNull();
    expect(Object.keys(held.errors)).toEqual(['key', 'message']);
  });

  it('reports a refusal and nothing else', () => {
    const values = { key: 'k', message: 'm', etag: null };
    const sent = { locale: 'en', key: 'k' };
    const denied = afterSave(
      refused(403, 'about:blank', { detail: 'the caller does not hold: manage-tenant' }),
      sent,
      values,
    );
    expect(denied.reported).not.toBeNull();
    expect(afterSave({ ok: false, kind: 'network' }, sent, values).reported).toBeNull();
    expect(
      afterSave({ ok: true, status: 200, data: {}, etag: null, next: null }, sent, values).reported,
    ).toBeNull();
  });
});
