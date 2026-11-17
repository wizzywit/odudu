import { REGISTRATION_USERNAME_MODES } from '@odudu/account';
import { REGISTRATION_USERNAME_CHOICES } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';

describe('the registration username modes', () => {
  it('are the contract’s choices, in the contract’s order', () => {
    expect([...REGISTRATION_USERNAME_MODES]).toEqual([...REGISTRATION_USERNAME_CHOICES]);
  });
});
