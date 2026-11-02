import { describe, expect, it } from 'vitest';
import {
  addable,
  added,
  canMove,
  chosenAddition,
  describeSteps,
  moved,
  stepsOf,
  withRequirement,
  type Step,
} from '#/features/flow/services/steps';

const FLOW: readonly Step[] = [
  { authenticator: 'passkey', requirement: 'alternative' },
  { authenticator: 'password', requirement: 'alternative' },
  { authenticator: 'otp', requirement: 'conditional' },
];

describe('stepsOf', () => {
  it('orders by index and drops it, since the order is the array', () => {
    expect(
      stepsOf([
        { index: 1, authenticator: 'password', requirement: 'required' },
        { index: 0, authenticator: 'passkey', requirement: 'alternative' },
      ]),
    ).toEqual([
      { authenticator: 'passkey', requirement: 'alternative' },
      { authenticator: 'password', requirement: 'required' },
    ]);
  });
});

describe('moved', () => {
  it('swaps a step with its neighbour', () => {
    expect(moved(FLOW, 'password', 'up').map((s) => s.authenticator)).toEqual([
      'password',
      'passkey',
      'otp',
    ]);
    expect(moved(FLOW, 'password', 'down').map((s) => s.authenticator)).toEqual([
      'passkey',
      'otp',
      'password',
    ]);
  });

  it('leaves the list as it is at either end, or for an unknown step', () => {
    expect(moved(FLOW, 'passkey', 'up')).toEqual(FLOW);
    expect(moved(FLOW, 'otp', 'down')).toEqual(FLOW);
    expect(moved(FLOW, 'nonesuch', 'down')).toEqual(FLOW);
  });
});

describe('canMove', () => {
  it('is false at the ends', () => {
    expect(canMove(FLOW, 'passkey', 'up')).toBe(false);
    expect(canMove(FLOW, 'passkey', 'down')).toBe(true);
    expect(canMove(FLOW, 'otp', 'down')).toBe(false);
  });
});

describe('withRequirement', () => {
  it('changes one step and no other', () => {
    expect(withRequirement(FLOW, 'otp', 'disabled')).toEqual([
      FLOW[0],
      FLOW[1],
      { authenticator: 'otp', requirement: 'disabled' },
    ]);
  });
});

describe('added and addable', () => {
  it('offers what is registered and not yet a step, in the registry order', () => {
    expect(addable(['password', 'passkey', 'otp', 'recovery-code'], FLOW)).toEqual([
      'recovery-code',
    ]);
  });

  it('appends a step at the end', () => {
    expect(added(FLOW, 'recovery-code', 'conditional').at(-1)).toEqual({
      authenticator: 'recovery-code',
      requirement: 'conditional',
    });
  });

  it('does not add one that is already a step', () => {
    expect(added(FLOW, 'otp', 'required')).toEqual(FLOW);
  });
});

describe('describeSteps', () => {
  it('reads the order with each requirement', () => {
    expect(describeSteps(FLOW)).toBe(
      '1 passkey (alternative), 2 password (alternative), 3 otp (conditional)',
    );
  });

  it('says none for no step, or for what is not a list', () => {
    expect(describeSteps([])).toBe('none');
    expect(describeSteps(undefined)).toBe('none');
  });
});

describe('chosenAddition', () => {
  it('keeps a pick that is still offered, else falls to the first, else nothing', () => {
    expect(chosenAddition(['otp', 'recovery-code'], 'recovery-code')).toBe('recovery-code');
    expect(chosenAddition(['otp', 'recovery-code'], 'password')).toBe('otp');
    expect(chosenAddition([], 'password')).toBe('');
  });
});
