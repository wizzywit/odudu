import { describe, expect, it } from 'vitest';
import {
  applicationActionSchema,
  linkedActionSchema,
  requiredActionSchema,
  sendActionsEmailRequestSchema,
  setRequiredActionsRequestSchema,
} from '#/admin/subjects';

describe('the required-action vocabulary', () => {
  it('names the seven actions, in the order a sign-in asks for them', () => {
    expect(requiredActionSchema.options).toEqual([
      'verify-email',
      'update-password',
      'configure-totp',
      'configure-passkey',
      'generate-recovery-codes',
      'update-profile',
      'accept-terms',
    ]);
  });

  it('lets a mailed link carry only the four a link can finish', () => {
    expect(linkedActionSchema.options).toEqual([
      'update-password',
      'configure-totp',
      'configure-passkey',
      'generate-recovery-codes',
    ]);
    expect(sendActionsEmailRequestSchema.safeParse({ actions: ['verify-email'] }).success).toBe(
      false,
    );
    expect(sendActionsEmailRequestSchema.safeParse({ actions: ['update-password'] }).success).toBe(
      true,
    );
  });

  it('lets an application start every action but the tenant terms', () => {
    expect(applicationActionSchema.options).toEqual([
      'verify-email',
      'update-password',
      'configure-totp',
      'configure-passkey',
      'generate-recovery-codes',
      'update-profile',
    ]);
    expect(applicationActionSchema.safeParse('accept-terms').success).toBe(false);
  });

  it('still refuses a name it does not know', () => {
    expect(setRequiredActionsRequestSchema.safeParse({ actions: ['accept-terms'] }).success).toBe(
      true,
    );
    expect(setRequiredActionsRequestSchema.safeParse({ actions: ['accept-tos'] }).success).toBe(
      false,
    );
  });
});
