import { describe, expect, it, vi } from 'vitest';
import { createTurnRegistry } from '#/service/turn-registry';

describe('the turn registry', () => {
  it('admits one turn for a conversation at a time', () => {
    const registry = createTurnRegistry(10);
    const first = registry.begin('c1', () => undefined);
    expect(first.kind).toBe('started');
    expect(registry.begin('c1', () => undefined).kind).toBe('busy');
    expect(registry.begin('c2', () => undefined).kind).toBe('started');
  });

  it('admits the conversation again once its turn has ended', () => {
    const registry = createTurnRegistry(10);
    const first = registry.begin('c1', () => undefined);
    if (first.kind === 'started') first.end();
    expect(registry.begin('c1', () => undefined).kind).toBe('started');
  });

  it('refuses a turn past its bound, and frees the place when one ends', () => {
    const registry = createTurnRegistry(2);
    const a = registry.begin('a', () => undefined);
    registry.begin('b', () => undefined);
    expect(registry.begin('c', () => undefined).kind).toBe('saturated');
    if (a.kind === 'started') a.end();
    expect(registry.begin('c', () => undefined).kind).toBe('started');
  });

  it('stops only the turn that runs, and says whether one did', () => {
    const registry = createTurnRegistry(10);
    const abort = vi.fn();
    registry.begin('c1', abort);
    expect(registry.stop('c2')).toBe(false);
    expect(registry.stop('c1')).toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('does not let a finished turn remove the one that replaced it', () => {
    const registry = createTurnRegistry(10);
    const old = registry.begin('c1', () => undefined);
    if (old.kind !== 'started') throw new Error('not started');
    old.end();
    const next = registry.begin('c1', () => undefined);
    old.end();
    expect(next.kind).toBe('started');
    expect(registry.begin('c1', () => undefined).kind).toBe('busy');
  });
});
