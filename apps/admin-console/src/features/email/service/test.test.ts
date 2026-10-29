import { describe, expect, it } from 'vitest';
import { TEST_RECIPIENT_RULE, testBlocked, testOutcome } from '#/features/email/service/test';
import type { GatewayResult } from '#/shared/service/result';

function problem(status: number, detail: string): GatewayResult<{ sent: boolean }> {
  return {
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank', title: 'x', status, detail },
  };
}

describe('testBlocked', () => {
  it('needs a relay of the tenant’s own and an address', () => {
    expect(testBlocked('a@b.example', false)).toMatch(/Save a relay/u);
    expect(testBlocked('  ', true)).toMatch(/address/u);
    expect(testBlocked('a@b.example', true)).toBeUndefined();
  });

  it('wants exactly one address', () => {
    for (const bad of [
      'a@b.example, c@d.example',
      'Ada <a@b.example>',
      'ada',
      'a@b.example;c@d.example',
    ]) {
      expect(testBlocked(bad, true), bad).toBe(TEST_RECIPIENT_RULE);
    }
  });
});

describe('testOutcome', () => {
  it('says the relay accepted the message, and that acceptance is not delivery', () => {
    const out = testOutcome(
      { ok: true, status: 200, data: { sent: true }, etag: null, next: null },
      'a@b.example',
    );
    expect(out.tone).toBe('success');
    expect(out.text).toMatch(/accepted a test message for a@b\.example/u);
    expect(out.text).toMatch(/not delivery/u);
  });

  it('says the relay did not take it when the server says it did not send', () => {
    const out = testOutcome(
      { ok: true, status: 200, data: { sent: false }, etag: null, next: null },
      'a@b.example',
    );
    expect(out.tone).toBe('error');
  });

  it('gives the server’s own reason for a refused destination', () => {
    const out = testOutcome(
      problem(400, 'this server will not connect to 10.0.0.1: private'),
      'a@b.example',
    );
    expect(out.tone).toBe('error');
    expect(out.text).toBe(
      'Not sent. The server said: this server will not connect to 10.0.0.1: private.',
    );
  });

  it('gives the transport’s own reason when the relay fails', () => {
    const out = testOutcome(problem(502, 'connect ECONNREFUSED 10.1.1.1:587'), 'a@b.example');
    expect(out.text).toBe('Not sent. The relay failed: connect ECONNREFUSED 10.1.1.1:587.');
  });

  it('does not offer to send again after a lost answer', () => {
    const out = testOutcome({ ok: false, kind: 'network' }, 'a@b.example');
    expect(out.tone).toBe('error');
    expect(out.text).toMatch(/Could not confirm whether the test message was sent/u);
    expect(out.text).toMatch(/not been sent again/u);
  });

  it('names the capability a refusal needs', () => {
    expect(testOutcome(problem(403, ''), 'a@b.example').text).toMatch(/manage-tenant/u);
  });
});
