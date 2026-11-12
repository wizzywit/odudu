import { describe, expect, it } from 'vitest';
import { type ActionTokenRecord } from '#/schema/action-tokens';
import { addressToProveAgain } from '#/service/resend-link';

function record(patch: Partial<ActionTokenRecord>): ActionTokenRecord {
  return {
    id: 'i',
    tenantId: 't',
    subjectId: 's',
    type: 'verify_email',
    tokenHash: 'h',
    email: 'ada@example.test',
    actions: null,
    createdAt: new Date(0),
    expiresAt: new Date(0),
    consumedAt: null,
    authenticationSessionId: null,
    returnTo: null,
    ...patch,
  };
}

describe('addressToProveAgain', () => {
  it('is the address a verification link was minted for, whether it expired or was used', () => {
    expect(addressToProveAgain(record({}))).toBe('ada@example.test');
    expect(addressToProveAgain(record({ consumedAt: new Date(1) }))).toBe('ada@example.test');
  });

  it('is nothing for a link of another kind, or one that named no address', () => {
    expect(addressToProveAgain(record({ type: 'reset_password' }))).toBeNull();
    expect(addressToProveAgain(record({ type: 'execute_actions' }))).toBeNull();
    expect(addressToProveAgain(record({ email: null }))).toBeNull();
  });

  it('is nothing when there is no link', () => {
    expect(addressToProveAgain(null)).toBeNull();
  });
});
