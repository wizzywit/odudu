import { expect, it } from 'vitest';
import { modelsOf } from '#/widgets/assistant-panel/services/models';

const SLOTS = { fast: 'f-1', standard: 's-1', deep: 'd-1' };

it('names the models only where there is more than one', () => {
  expect(modelsOf({ enabled: true, slots: SLOTS, modelChoices: ['f-1', 's-1', 'd-1'] })).toEqual([
    { slot: 'fast', model: 'f-1' },
    { slot: 'standard', model: 's-1' },
    { slot: 'deep', model: 'd-1' },
  ]);
  expect(modelsOf({ enabled: true, slots: SLOTS, modelChoices: ['s-1'] })).toBeNull();
});

it('names none for an assistant that is off or did not say', () => {
  expect(modelsOf({ enabled: false })).toBeNull();
  expect(modelsOf({ enabled: true, slots: SLOTS })).toBeNull();
});
