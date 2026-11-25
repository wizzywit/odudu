import { expect, it } from 'vitest';
import { ownerFilterOf, ownerNarrowing, stateChoice } from '#/pages/agents/services/filters';

it('shows the state the address names, or any', () => {
  expect(stateChoice({ state: 'live' })).toBe('live');
  expect(stateChoice({})).toBe('any');
});

it('names the owner the list is narrowed to, or none', () => {
  expect(ownerFilterOf({ owner: 'sub-ada' })).toBe('sub-ada');
  expect(ownerFilterOf({ state: 'live' })).toBeNull();
});

it('says what the list is narrowed to, with the way back, only while it is', () => {
  const clear = (): void => undefined;
  expect(ownerNarrowing({}, clear)).toBeNull();
  expect(ownerNarrowing({ owner: '0197a3b2-1c4d-7e5f' }, clear)).toEqual({
    note: 'Only the runs acting for 0197a3b2.',
    all: 'Show every agent',
    clear,
  });
});
