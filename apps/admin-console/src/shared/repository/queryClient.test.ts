import { describe, expect, it } from 'vitest';
import { createQueryClient } from '#/shared/repository/queryClient.ts';

describe('createQueryClient', () => {
  const defaults = createQueryClient().getDefaultOptions();

  it('refetches reads when the window regains focus', () => {
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
  });

  it('leaves read retries to the transport, so they are not doubled', () => {
    expect(defaults.queries?.retry).toBe(false);
  });

  it('never retries a mutation', () => {
    expect(defaults.mutations?.retry).toBe(false);
  });

  it('gives each caller its own client', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
