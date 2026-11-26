import { expect, it } from 'vitest';
import { actingInText, modeChoices } from '#/widgets/assistant-panel/services/crossTenant';

it('names the tenant the conversation acts in, and none in the own tenant', () => {
  expect(actingInText('demo')).toBe('Acting in demo');
  expect(actingInText(null)).toBeNull();
});

it('offers the modes as the status gave them in the own tenant', () => {
  expect(modeChoices(['ask'], null)).toEqual(['ask']);
  expect(modeChoices(['ask', 'act'], null)).toEqual(['ask', 'act']);
});

it('draws both choices in another tenant, so that Act can say why it is not one', () => {
  expect(modeChoices(['ask'], 'demo')).toEqual(['ask', 'act']);
});
