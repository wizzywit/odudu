import { describe, expect, it } from 'vitest';
import { STEPS } from '@site/src/features/landing/services/startSteps';

describe('the steps of the start', () => {
  it('shows the three steps of the start, in order', () => {
    expect(STEPS.map((step) => step.title)).toEqual([
      'Start it',
      'Sign in to the console',
      'Sign a person in to an app',
    ]);
  });
});
