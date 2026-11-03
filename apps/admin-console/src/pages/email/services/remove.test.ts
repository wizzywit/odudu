import { describe, expect, it } from 'vitest';
import { removeConsequence, removeOutcome } from '#/pages/email/services/remove';
import type { GatewayResult } from '#/shared/lib/services/result';

describe('removeConsequence', () => {
  it('says where the tenant’s mail goes instead', () => {
    expect(removeConsequence()).toMatch(/deployment’s sender/u);
    expect(removeConsequence()).toMatch(/only logged/u);
  });
});

describe('removeOutcome', () => {
  it('is done when removed, and when there was nothing to remove', () => {
    expect(
      removeOutcome({ ok: true, status: 204, data: undefined, etag: null, next: null }),
    ).toMatchObject({
      done: true,
    });
    const gone: GatewayResult<unknown> = {
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Not Found', status: 404 },
    };
    const out = removeOutcome(gone);
    expect(out.done).toBe(true);
    expect(out.text).toMatch(/already had none/u);
  });

  it('is not done, and says so, when the answer is lost', () => {
    const out = removeOutcome({ ok: false, kind: 'network' });
    expect(out.done).toBe(false);
    expect(out.text).toMatch(/Could not confirm/u);
  });
});
