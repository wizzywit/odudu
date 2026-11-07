import { describe, expect, it } from 'vitest';
import { memoryWriteBudget, WRITE_BUDGET } from '#/service/write-budget';

describe('the write budget of one grant', () => {
  it('is 20 mutating calls and 10 creates', () => {
    expect(WRITE_BUDGET).toEqual({ mutating: 20, creates: 10 });
  });

  it('admits twenty mutating calls and refuses the twenty-first', async () => {
    const budget = memoryWriteBudget();
    for (let i = 0; i < 20; i += 1) expect(await budget.reserve('mutating')).toBe(true);
    expect(await budget.reserve('mutating')).toBe(false);
  });

  it('admits ten creates, each of which is also a mutating call', async () => {
    const budget = memoryWriteBudget();
    for (let i = 0; i < 10; i += 1) expect(await budget.reserve('create')).toBe(true);
    expect(await budget.reserve('create')).toBe(false);
    for (let i = 0; i < 10; i += 1) expect(await budget.reserve('mutating')).toBe(true);
    expect(await budget.reserve('mutating')).toBe(false);
  });

  it('gives a call back, creates and all', async () => {
    const budget = memoryWriteBudget();
    for (let i = 0; i < 10; i += 1) await budget.reserve('create');
    await budget.release('create');
    expect(await budget.reserve('create')).toBe(true);
    expect(await budget.reserve('create')).toBe(false);
  });

  it('never goes below nothing spent', async () => {
    const budget = memoryWriteBudget();
    await budget.release('create');
    await budget.release('mutating');
    for (let i = 0; i < 20; i += 1) expect(await budget.reserve('mutating')).toBe(true);
    expect(await budget.reserve('mutating')).toBe(false);
  });

  it('admits exactly the limit when thirty ask at once', async () => {
    const budget = memoryWriteBudget();
    const answers = await Promise.all(Array.from({ length: 30 }, () => budget.reserve('mutating')));
    expect(answers.filter(Boolean)).toHaveLength(20);
  });

  it('is separate for each budget made', async () => {
    const first = memoryWriteBudget();
    const second = memoryWriteBudget();
    for (let i = 0; i < 20; i += 1) await first.reserve('mutating');
    expect(await first.reserve('mutating')).toBe(false);
    expect(await second.reserve('mutating')).toBe(true);
  });
});
