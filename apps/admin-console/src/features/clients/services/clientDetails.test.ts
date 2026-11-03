import { expect, it } from 'vitest';
import { ACTIVITY_NOTE, TYPE_TEXT } from '#/features/clients/services/clientDetails';

it('names the two types', () => {
  expect(TYPE_TEXT).toEqual({ confidential: 'Confidential', public: 'Public' });
});

it('says what the Activity tab leaves out', () => {
  expect(ACTIVITY_NOTE).toContain('not here');
});
