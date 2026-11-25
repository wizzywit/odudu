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

it('says what the list is narrowed to, by the owner’s username when a row names it', () => {
  const clear = (): void => undefined;
  const ada = { owner: '0197a3b2-aaaa', ownerUsername: 'ada' };
  expect(ownerNarrowing({}, [ada], clear)).toBeNull();
  expect(ownerNarrowing({ owner: '0197a3b2-aaaa' }, [ada], clear)).toEqual({
    note: 'Only the runs acting for ada.',
    all: 'Show every agent',
    clear,
  });
  expect(ownerNarrowing({ owner: '0197a3b2-aaaa' }, [], clear)?.note).toBe(
    'Only the runs acting for 3b2-aaaa.',
  );
});
