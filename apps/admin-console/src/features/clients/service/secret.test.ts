import { expect, it } from 'vitest';
import {
  GRACE_MAX,
  rotatedNote,
  rotatedTitle,
  rotateConsequence,
} from '#/features/clients/service/secret.ts';

it('holds the grace to the week the server allows', () => {
  expect(GRACE_MAX).toBe(604_800);
});

it('says the current secret stops at once, or after the grace, in the dialog that asks', () => {
  expect(rotateConsequence('billing', 0)).toContain('stops working at once');
  expect(rotateConsequence('billing', 3600)).toContain(
    'keeps working for 3600 s · 1 hour, then stops',
  );
});

it('names the client in the title and what became of the previous secret', () => {
  expect(rotatedTitle('billing')).toBe('New client secret for billing');
  expect(rotatedNote('billing', 0)).toContain('no longer works');
  expect(rotatedNote('billing', 60)).toContain('60 s · 1 minute');
});
