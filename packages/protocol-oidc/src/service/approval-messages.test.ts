import { describe, expect, it } from 'vitest';
import { cibaApprovalSummary } from '#/service/approval-messages';

describe('cibaApprovalSummary', () => {
  it('names the client and the scopes asked for', () => {
    expect(cibaApprovalSummary('Calendar', ['openid', 'email'])).toBe(
      'Calendar asks to sign in as you with: openid email',
    );
  });

  it('keeps a client name that looks like a placeholder as it is', () => {
    expect(cibaApprovalSummary('{scope}', ['openid'])).toBe(
      '{scope} asks to sign in as you with: openid',
    );
  });
});
