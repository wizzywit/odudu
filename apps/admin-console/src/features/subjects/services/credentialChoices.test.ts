import { describe, expect, it } from 'vitest';
import {
  CHOICE_DEFAULTS,
  choiceControl,
  choiceKeyOf,
  choicesWith,
} from '#/features/subjects/services/credentialChoices';

describe('credential choices', () => {
  const factor = {
    kind: 'factor',
    credential: { id: 'c1', type: 'totp', created_at: 'x' },
    last: false,
  } as const;
  const lastFactor = { ...factor, last: true } as const;

  it('offers a choice only where one changes the outcome, ticked for a new set only', () => {
    expect(choiceKeyOf(factor)).toBeNull();
    expect(choiceKeyOf(lastFactor)).toBe('endSessions');
    expect(choiceKeyOf({ kind: 'recovery-codes', hasFactor: true })).toBe('newSet');
    expect(choiceKeyOf({ kind: 'recovery-codes', hasFactor: false })).toBeNull();
    expect(choiceKeyOf({ kind: 'lockout' })).toBeNull();
    expect(choiceKeyOf({ kind: 'password' })).toBeNull();
    expect(CHOICE_DEFAULTS).toEqual({ newSet: true, endSessions: false });
    const seen: unknown[] = [];
    const control = choiceControl(lastFactor, CHOICE_DEFAULTS, (next) => seen.push(next));
    expect(control?.checked).toBe(false);
    control?.onChange(true);
    expect(seen).toEqual([{ newSet: true, endSessions: true }]);
    expect(choiceControl(factor, CHOICE_DEFAULTS, () => undefined)).toBeNull();
    expect(choiceControl(null, CHOICE_DEFAULTS, () => undefined)).toBeNull();
    expect(choicesWith(CHOICE_DEFAULTS, 'newSet', false)).toEqual({
      newSet: false,
      endSessions: false,
    });
  });
});
