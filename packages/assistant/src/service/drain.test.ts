import { describe, expect, it, vi } from 'vitest';
import { drain } from '#/service/drain';
import { UPKEEP_MAX_ROUNDS } from '#/service/limits';

describe('drain', () => {
  it('stops at the first batch that comes back short', async () => {
    const take = vi
      .fn()
      .mockResolvedValueOnce(200)
      .mockResolvedValueOnce(200)
      .mockResolvedValue(50);
    expect(await drain(take, 200)).toBe(450);
    expect(take).toHaveBeenCalledTimes(3);
  });

  it('takes one round when the first is short', async () => {
    const take = vi.fn().mockResolvedValue(0);
    expect(await drain(take, 200)).toBe(0);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('gives up after the most rounds a pass may take, leaving the rest for the next', async () => {
    const take = vi.fn().mockResolvedValue(200);
    expect(await drain(take, 200)).toBe(200 * UPKEEP_MAX_ROUNDS);
    expect(take).toHaveBeenCalledTimes(UPKEEP_MAX_ROUNDS);
  });

  it('lets a failing round fail the pass', async () => {
    await expect(drain(() => Promise.reject(new Error('down')), 1)).rejects.toThrow('down');
  });
});
