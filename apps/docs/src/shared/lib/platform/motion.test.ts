import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REDUCED_MOTION_QUERY,
  prefersReducedMotion,
  serverReducedMotion,
  subscribeReducedMotion,
} from '@site/src/shared/platform/motion';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubMedia(matches: boolean): {
  query: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const add = vi.fn();
  const remove = vi.fn();
  const query = vi.fn(() => ({ matches, addEventListener: add, removeEventListener: remove }));
  vi.stubGlobal('window', { matchMedia: query });
  return { query, add, remove };
}

describe('the reduced motion preference', () => {
  it('asks the browser the reduced motion query', () => {
    const media = stubMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(media.query).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('is false where the query does not match, and always on the server', () => {
    stubMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(serverReducedMotion()).toBe(false);
  });

  it('listens for a change and stops listening when told to', () => {
    const media = stubMedia(false);
    const onChange = vi.fn();
    const stop = subscribeReducedMotion(onChange);
    expect(media.add).toHaveBeenCalledWith('change', onChange);
    expect(media.remove).not.toHaveBeenCalled();
    stop();
    expect(media.remove).toHaveBeenCalledWith('change', onChange);
  });
});
