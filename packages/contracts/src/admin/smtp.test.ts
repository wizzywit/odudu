import { describe, expect, it } from 'vitest';
import { smtpPortSchema } from '#/admin/smtp';

describe('smtpPortSchema', () => {
  it('refuses 0 and 65536, the values one past each bound', () => {
    expect(smtpPortSchema.safeParse(0).success).toBe(false);
    expect(smtpPortSchema.safeParse(65536).success).toBe(false);
  });

  it('accepts 1 and 65535, the bounds themselves', () => {
    expect(smtpPortSchema.safeParse(1).success).toBe(true);
    expect(smtpPortSchema.safeParse(65535).success).toBe(true);
  });
});
