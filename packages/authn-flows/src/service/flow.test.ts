import { describe, expect, it } from 'vitest';
import { type Flow } from '#/schema/flow';
import {
  flowStepsSchema,
  MAX_FLOW_STEPS,
  registeredFlowStepsSchema,
  resolveFlow,
} from '#/service/flow';

const TENANT = '00000000-0000-4000-8000-000000000001';

function flow(id: string, name: string, isDefault: boolean): Flow {
  return {
    id,
    tenantId: TENANT,
    name,
    isDefault,
    steps: [{ authenticator: 'password', requirement: 'required' }],
  };
}

describe('resolveFlow', () => {
  const fallback = flow('f-default', 'default', true);
  const other = flow('f-other', 'staff', false);

  it('returns the tenant default when the client names no flow', () => {
    expect(resolveFlow([other, fallback], null)).toEqual({ kind: 'ok', flow: fallback });
  });

  it('returns the flow a client override names', () => {
    expect(resolveFlow([fallback, other], 'f-other')).toEqual({ kind: 'ok', flow: other });
  });

  it('refuses an override that names no flow of the tenant, never falling back', () => {
    expect(resolveFlow([fallback, other], 'f-gone')).toEqual({
      kind: 'unknown_flow',
      flowId: 'f-gone',
    });
  });

  it('refuses a tenant with no default when no override is given', () => {
    expect(resolveFlow([other], null)).toEqual({ kind: 'no_default' });
    expect(resolveFlow([], null)).toEqual({ kind: 'no_default' });
  });

  it('does not need a default to honour an override', () => {
    expect(resolveFlow([other], 'f-other')).toEqual({ kind: 'ok', flow: other });
  });
});

describe('flowStepsSchema', () => {
  const step = { authenticator: 'password', requirement: 'required' };

  it('accepts an ordered list of authenticator and requirement', () => {
    expect(flowStepsSchema.parse([step, { ...step, authenticator: 'otp' }])).toHaveLength(2);
  });

  it('accepts an empty list and a list of exactly the bound', () => {
    expect(flowStepsSchema.parse([])).toEqual([]);
    expect(flowStepsSchema.parse(Array.from({ length: MAX_FLOW_STEPS }, () => step))).toHaveLength(
      MAX_FLOW_STEPS,
    );
  });

  it('refuses a list past the bound', () => {
    expect(
      flowStepsSchema.safeParse(Array.from({ length: MAX_FLOW_STEPS + 1 }, () => step)).success,
    ).toBe(false);
  });

  it('refuses a key a step does not have, and a requirement outside the four', () => {
    expect(flowStepsSchema.safeParse([{ ...step, colour: 'red' }]).success).toBe(false);
    expect(flowStepsSchema.safeParse([{ ...step, requirement: 'sometimes' }]).success).toBe(false);
    expect(
      flowStepsSchema.safeParse([{ authenticator: '', requirement: 'required' }]).success,
    ).toBe(false);
  });

  it('refuses an authenticator the registry does not name, when given the registry', () => {
    const schema = registeredFlowStepsSchema(['password']);
    expect(schema.safeParse([step]).success).toBe(true);
    expect(schema.safeParse([{ ...step, authenticator: 'bogus' }]).success).toBe(false);
  });
});

describe('flowStepsSchema settings', () => {
  const otp = { authenticator: 'otp', requirement: 'required' } as const;

  it('accepts the settings an authenticator reads', () => {
    expect(
      flowStepsSchema.safeParse([
        { ...otp, settings: { algorithm: 'SHA256', digits: 8, period: 60 } },
        {
          authenticator: 'passkey',
          requirement: 'alternative',
          settings: { user_verification: 'preferred', resident_key: 'discouraged' },
        },
        { authenticator: 'recovery-code', requirement: 'conditional', settings: { count: 12 } },
        { ...otp, authenticator: 'recovery-code', settings: {} },
      ]).success,
    ).toBe(true);
  });

  it('refuses a setting another authenticator reads, and any on one that reads none', () => {
    expect(flowStepsSchema.safeParse([{ ...otp, settings: { count: 10 } }]).success).toBe(false);
    expect(
      flowStepsSchema.safeParse([
        { authenticator: 'password', requirement: 'required', settings: { digits: 6 } },
      ]).success,
    ).toBe(false);
    expect(
      flowStepsSchema.safeParse([
        { authenticator: 'password', requirement: 'required', settings: {} },
      ]).success,
    ).toBe(false);
  });

  it('holds each value to the choices and range of the tenant setting', () => {
    const refused = (settings: Record<string, unknown>) =>
      flowStepsSchema.safeParse([{ ...otp, settings }]).success;
    expect(refused({ algorithm: 'MD5' })).toBe(false);
    expect(refused({ digits: 7 })).toBe(false);
    expect(refused({ period: 45 })).toBe(false);
    expect(refused({ unknown: 1 })).toBe(false);
    expect(
      flowStepsSchema.safeParse([
        { authenticator: 'recovery-code', requirement: 'required', settings: { count: 7 } },
      ]).success,
    ).toBe(false);
    expect(
      flowStepsSchema.safeParse([
        { authenticator: 'recovery-code', requirement: 'required', settings: { count: 17 } },
      ]).success,
    ).toBe(false);
  });

  it('holds the recovery set size to 8 and 16 inclusive', () => {
    const count = (value: number) =>
      flowStepsSchema.safeParse([
        { authenticator: 'recovery-code', requirement: 'required', settings: { count: value } },
      ]).success;
    expect([count(7), count(8), count(16), count(17)]).toEqual([false, true, true, false]);
  });

  it('reads no settings for a name an object inherits', () => {
    const named = (authenticator: string) =>
      flowStepsSchema.safeParse([{ authenticator, requirement: 'required', settings: {} }]).success;
    expect(named('constructor')).toBe(false);
    expect(named('toString')).toBe(false);
    expect(
      flowStepsSchema.safeParse([{ authenticator: 'constructor', requirement: 'required' }])
        .success,
    ).toBe(true);
  });
});
