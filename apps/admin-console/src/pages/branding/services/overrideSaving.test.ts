import { MESSAGE_OVERRIDE_LIMIT } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  afterSave,
  settle,
  overrideAttempt,
  overrideFailure,
} from '#/pages/branding/services/overrideSaving';
import {
  EMPTY_OVERRIDE,
  OVER_BOUND,
  OVERRIDE_CAP,
  UNKNOWN_KEY,
} from '#/pages/branding/services/overrideForm';
import type { GatewayFailure } from '#/shared/lib/services/result';

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

describe('the form as it is sent', () => {
  it('trims the key, and is not sent while it has problems', () => {
    expect(
      overrideAttempt('en', { key: ' login.title ', message: 'Hi', etag: '"v1"' }).sent,
    ).toEqual({ locale: 'en', key: 'login.title', message: 'Hi', etag: '"v1"' });
    const held = overrideAttempt('en', EMPTY_OVERRIDE);
    expect(held.sent).toBeNull();
    expect(Object.keys(held.errors)).toEqual(['key', 'message']);
  });

  it('settles into a toast for a save and a report for a refusal, in that order', () => {
    const values = { key: 'k', message: 'm', etag: null };
    const sent = { locale: 'en', key: 'k' };
    const saved = settle(
      afterSave({ ok: true, status: 200, data: {}, etag: null, next: null }, sent, values),
    );
    expect(saved.map((step) => step.kind)).toEqual(['toast']);
    const denied = settle(
      afterSave(
        refused(403, 'about:blank', { detail: 'the caller does not hold: manage-tenant' }),
        sent,
        values,
      ),
    );
    expect(denied.map((step) => step.kind)).toEqual(['report']);
    expect(settle(afterSave({ ok: false, kind: 'network' }, sent, values))).toEqual([]);
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
