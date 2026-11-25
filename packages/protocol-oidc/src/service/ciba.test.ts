import { describe, expect, it } from 'vitest';
import {
  BINDING_MESSAGE_MAX_LENGTH,
  generateAuthReqId,
  hashAuthReqId,
  hintDigest,
  parseBackchannelRequest,
} from '#/service/ciba';

const ok = { scope: 'openid profile', login_hint: 'alice' };

describe('parseBackchannelRequest', () => {
  it('[OIDC-CIBA-7.1-03] needs openid in the scope', () => {
    expect(parseBackchannelRequest({ login_hint: 'a', scope: 'profile' })).toEqual({
      ok: false,
      error: 'invalid_scope',
    });
    expect(parseBackchannelRequest({ login_hint: 'a' })).toEqual({
      ok: false,
      error: 'invalid_scope',
    });
    expect(parseBackchannelRequest(ok)).toMatchObject({ ok: true });
  });

  it('[OIDC-CIBA-7.1-04] needs exactly one hint', () => {
    expect(parseBackchannelRequest({ scope: 'openid' })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
  });

  it('[OIDC-CIBA-7.2-02] refuses more than one hint', () => {
    expect(parseBackchannelRequest({ ...ok, id_token_hint: 'x.y.z' })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
  });

  it.each(['user_code', 'client_notification_token', 'login_hint_token', 'request', 'request_uri'])(
    '[OIDC-CIBA-7.1.1-01] refuses a request carrying %s',
    (name) => {
      expect(parseBackchannelRequest({ ...ok, [name]: 'x' })).toEqual({
        ok: false,
        error: 'invalid_request',
      });
    },
  );

  it('[OIDC-CIBA-7.2-05] ignores a parameter it does not know', () => {
    expect(parseBackchannelRequest({ ...ok, acr_values: 'a', anything: 'b' })).toMatchObject({
      ok: true,
    });
  });

  it('[OIDC-CIBA-7.1-05] keeps the binding message as written, caps it at 140 characters and refuses control characters', () => {
    const parsed = parseBackchannelRequest({ ...ok, binding_message: '<b>"hi" & \'bye\'</b>' });
    expect(parsed).toMatchObject({
      ok: true,
      request: { bindingMessage: '<b>"hi" & \'bye\'</b>' },
    });
    expect(
      parseBackchannelRequest({ ...ok, binding_message: 'x'.repeat(BINDING_MESSAGE_MAX_LENGTH) }),
    ).toMatchObject({ ok: true });
    expect(
      parseBackchannelRequest({
        ...ok,
        binding_message: 'x'.repeat(BINDING_MESSAGE_MAX_LENGTH + 1),
      }),
    ).toEqual({ ok: false, error: 'invalid_binding_message' });
    for (const bad of ['a\nb', 'a\u0000b', 'a\u200Bb', 'a\u202Eb', 'a\u2028b']) {
      expect(parseBackchannelRequest({ ...ok, binding_message: bad }), bad).toEqual({
        ok: false,
        error: 'invalid_binding_message',
      });
    }
  });

  it('[OIDC-CIBA-7.1-06] reads requested_expiry as a positive integer', () => {
    expect(parseBackchannelRequest({ ...ok, requested_expiry: '120' })).toMatchObject({
      ok: true,
      request: { requestedExpiry: 120 },
    });
    for (const bad of ['0', '-5', '1.5', 'abc', '99999999999999999999', '']) {
      expect(parseBackchannelRequest({ ...ok, requested_expiry: bad }), bad).toEqual(
        bad === ''
          ? expect.objectContaining({ ok: true })
          : { ok: false, error: 'invalid_request' },
      );
    }
  });

  it('refuses a repeated parameter', () => {
    expect(parseBackchannelRequest({ ...ok, login_hint: ['a', 'b'] })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
  });
});

describe('a login hint', () => {
  it.each(['a\u0000b', 'a\nb', 'a\u2028b', 'a\u202Eb'])(
    '[ODUDU-CIBA-HINT-01] refuses %j',
    (hint) => {
      expect(parseBackchannelRequest({ scope: 'openid', login_hint: hint })).toEqual({
        ok: false,
        error: 'invalid_request',
      });
    },
  );
});

describe('a login hint the username policy allows', () => {
  it.each(['ra\u200Dmya', 'a\u200Cb'])('[ODUDU-CIBA-HINT-02] accepts %j', (hint) => {
    expect(parseBackchannelRequest({ scope: 'openid', login_hint: hint })).toMatchObject({
      ok: true,
    });
  });
});

describe('auth_req_id', () => {
  it('[OIDC-CIBA-7.3-02] holds at least 128 bits drawn at random, in the permitted characters', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateAuthReqId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9._-]+$/u);
      expect(Buffer.from(id, 'base64url').length).toBeGreaterThanOrEqual(16);
    }
  });

  it('is stored as a digest that is not the id', () => {
    const id = generateAuthReqId();
    expect(hashAuthReqId(id)).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashAuthReqId(id)).not.toContain(id);
    expect(hashAuthReqId(id)).toBe(hashAuthReqId(id));
  });
});

describe('hintDigest', () => {
  it('[ODUDU-CIBA-CAP-05] folds the case of an address as the account lookup does, and of nothing else', () => {
    expect(hintDigest('t1', 'Alice@Example.Test')).toBe(hintDigest('t1', 'alice@example.test'));
    expect(hintDigest('t1', 'Alice')).not.toBe(hintDigest('t1', 'alice'));
  });

  it('differs by tenant and by hint', () => {
    expect(hintDigest('t1', 'a')).not.toBe(hintDigest('t2', 'a'));
    expect(hintDigest('t1', 'a')).not.toBe(hintDigest('t1', 'b'));
    expect(hintDigest('t1', 'a')).toBe(hintDigest('t1', 'a'));
  });
});
