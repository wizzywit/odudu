import { expect, it } from 'vitest';
import { actingInText, actNoteOf } from '#/widgets/assistant-panel/services/crossTenant';

it('names the tenant the conversation acts in, and none in the own tenant', () => {
  expect(actingInText('demo')).toBe('Acting in demo');
  expect(actingInText(null)).toBeNull();
});

it('says where changes land only for Act in another tenant', () => {
  expect(actNoteOf('demo', 'act')).toBe(
    'Act makes changes in demo, not in your own tenant. Each one waits for your approval.',
  );
  expect(actNoteOf('demo', 'ask')).toBeNull();
  expect(actNoteOf(null, 'act')).toBeNull();
});
