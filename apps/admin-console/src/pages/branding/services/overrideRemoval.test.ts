import { describe, expect, it } from 'vitest';
import { ALREADY_REMOVED, removeOutcome } from '#/pages/branding/services/overrideRemoval';
import type { GatewayFailure } from '#/shared/lib/services/result';

const refused = (status: number, type: string, extra: object = {}): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type, status, title: 'Refused', ...extra },
});

describe('removing an override', () => {
  it('counts one that is already gone as done', () => {
    const outcome = removeOutcome(refused(404, 'about:blank'));
    expect(outcome).toEqual({ done: true, text: ALREADY_REMOVED });
  });
});
