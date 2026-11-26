import { describe, expect, it } from 'vitest';
import { deriveApprovalSecret } from '#/service/approval-secret';

describe('the approval secret', () => {
  const kek = Buffer.alloc(32, 7);

  it('is the same for one KEK, differs for another, and is not the KEK', () => {
    const a = deriveApprovalSecret(kek);
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(deriveApprovalSecret(Buffer.alloc(32, 7))))).toBe(
      true,
    );
    expect(Buffer.from(a).equals(Buffer.from(deriveApprovalSecret(Buffer.alloc(32, 8))))).toBe(
      false,
    );
    expect(Buffer.from(a).equals(kek)).toBe(false);
  });

  it('refuses an empty key, so signing is never switched off by a missing value', () => {
    expect(() => deriveApprovalSecret(new Uint8Array())).toThrow(/empty/u);
  });
});
