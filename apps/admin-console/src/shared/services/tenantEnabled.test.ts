import { expect, it } from 'vitest';
import { disableConsequence, disableFixed } from '#/shared/services/tenantEnabled';

it('says why the system tenant cannot be switched off, and nothing for another', () => {
  expect(disableFixed('system')).toMatch(/^system cannot be disabled/u);
  expect(disableFixed('acme')).toBeNull();
});

it('says who is locked out, and that only a system administrator can undo it', () => {
  const text = disableConsequence('acme', false);
  expect(text).toMatch(/^Nobody can sign in to acme while it is disabled/u);
  expect(text).toMatch(/Only a system administrator can enable it again/u);
});

it('tells only an operator signed in to that tenant that their own session ends', () => {
  expect(disableConsequence('acme', true)).toMatch(/Your own console session in acme ends/u);
  expect(disableConsequence('acme', false)).not.toMatch(/Your own/u);
});
