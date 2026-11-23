import { describe, expect, it } from 'vitest';
import { createBudget, declaresMoreThan } from '#/services/byte-budget';

describe('createBudget', () => {
  it('allows exactly the limit and refuses the byte after it, and stays refused', () => {
    const budget = createBudget(10);
    expect(budget.spend(6)).toBe(true);
    expect(budget.spend(4)).toBe(true);
    expect(budget.exceeded()).toBe(false);
    expect(budget.spend(1)).toBe(false);
    expect(budget.exceeded()).toBe(true);
    expect(budget.spend(0)).toBe(false);
  });
});

describe('declaresMoreThan', () => {
  it('reads a length header and says whether it is over the limit', () => {
    expect(declaresMoreThan('11', 10)).toBe(true);
    expect(declaresMoreThan('10', 10)).toBe(false);
    expect(declaresMoreThan(null, 10)).toBe(false);
    expect(declaresMoreThan('not a number', 10)).toBe(false);
  });
});
