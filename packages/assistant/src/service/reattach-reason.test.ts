import { describe, expect, it } from 'vitest';
import { endedReasonOf } from '#/service/reattach-reason';

describe('endedReasonOf', () => {
  it('names a hidden conversation', () => {
    expect(endedReasonOf('conversation_archived')).toBe('archived');
  });

  it.each([
    'revoked_for_cause',
    'conversation_grant_missing',
    'conversation_grant_not_assistant',
    'subject_mismatch',
  ])('says %s ended for good', (code) => {
    expect(endedReasonOf(code)).toBe('revoked');
  });

  it.each([
    'assistant_unavailable',
    'owner_lacks_capability',
    'target_assistant_disabled',
    'session_ended',
    'grant_revoked',
    'grant_not_found',
    'anything else',
  ])('says %s is for this sign-in to fix, not the conversation', (code) => {
    expect(endedReasonOf(code)).toBe('not_allowed');
  });
});
