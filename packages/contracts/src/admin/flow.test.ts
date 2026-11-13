import { describe, expect, it } from 'vitest';
import { FLOW_NAME_MAX, FLOW_STEP_MAX, saveFlowRequestSchema } from '#/admin/flow';

const step = { authenticator: 'password', requirement: 'required' } as const;

describe('saveFlowRequestSchema', () => {
  it('trims the name and keeps the steps in order', () => {
    const parsed = saveFlowRequestSchema.parse({ name: '  staff  ', steps: [step] });
    expect(parsed).toEqual({ name: 'staff', steps: [step] });
  });

  it('refuses an empty name, and one only whitespace', () => {
    expect(saveFlowRequestSchema.safeParse({ name: '', steps: [step] }).success).toBe(false);
    expect(saveFlowRequestSchema.safeParse({ name: '   ', steps: [step] }).success).toBe(false);
  });

  it('counts the name in code points, not UTF-16 units', () => {
    const atLimit = '\u{1F512}'.repeat(FLOW_NAME_MAX);
    expect(saveFlowRequestSchema.safeParse({ name: atLimit, steps: [step] }).success).toBe(true);
    expect(saveFlowRequestSchema.safeParse({ name: `${atLimit}x`, steps: [step] }).success).toBe(
      false,
    );
  });

  it('refuses a name carrying a bidirectional control or a NUL', () => {
    expect(saveFlowRequestSchema.safeParse({ name: 'a‮b', steps: [step] }).success).toBe(false);
    expect(saveFlowRequestSchema.safeParse({ name: 'a\u0000b', steps: [step] }).success).toBe(
      false,
    );
  });

  it('refuses more steps than the bound, and a field a step does not have', () => {
    const many = Array.from({ length: FLOW_STEP_MAX + 1 }, () => step);
    expect(saveFlowRequestSchema.safeParse({ name: 'a', steps: many }).success).toBe(false);
    expect(
      saveFlowRequestSchema.safeParse({ name: 'a', steps: [{ ...step, extra: 1 }] }).success,
    ).toBe(false);
  });

  it('refuses a body with a field of its own that is not named', () => {
    expect(
      saveFlowRequestSchema.safeParse({ name: 'a', steps: [step], is_default: true }).success,
    ).toBe(false);
  });
});
