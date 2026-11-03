import { describe, expect, it, vi } from 'vitest';
import { useProbe } from '@site/src/shared/use-cases/useProbe';

// The server snapshot or the client's, whichever the test is standing in for.
const where = vi.hoisted(() => ({ server: true }));

vi.mock('react', () => ({
  useSyncExternalStore: (
    _subscribe: () => () => void,
    client: () => boolean,
    server: () => boolean,
  ) => (where.server ? server() : client()),
}));

describe('useProbe', () => {
  it('says no on the server, without asking the probe', () => {
    where.server = true;
    const probe = vi.fn(() => true);
    expect(useProbe(probe)).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it("answers with the probe's own result in the browser", () => {
    where.server = false;
    expect(useProbe(() => true)).toBe(true);
    expect(useProbe(() => false)).toBe(false);
  });
});
