import { describe, expect, it, vi } from 'vitest';
import {
  createMessageOverrides,
  MAX_OVERRIDE_READS_IN_FLIGHT,
  OVERRIDE_BACKOFF_MS,
} from '#/message-overrides';

function setup(read: (tenantId: string, locale: string) => Promise<Record<string, string>>) {
  let now = 1_000;
  const log = vi.fn();
  const overrides = createMessageOverrides({ read, now: () => now, log });
  return {
    overrides,
    log,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the message override reader', () => {
  it('reads once for a tenant and locale, then from memory', async () => {
    const read = vi.fn(() => Promise.resolve({ 'login.title': 'Hi' }));
    const { overrides } = setup(read);
    expect(await overrides.resolveOverrides('t1', 'fr')).toEqual({ 'login.title': 'Hi' });
    expect(await overrides.resolveOverrides('t1', 'fr')).toEqual({ 'login.title': 'Hi' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('remembers that a tenant has none, so a plain tenant costs no query per page', async () => {
    const read = vi.fn(() => Promise.resolve({}));
    const { overrides } = setup(read);
    await overrides.resolveOverrides('t1', 'en');
    await overrides.resolveOverrides('t1', 'en');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps tenants and locales apart', async () => {
    const read = vi.fn((tenantId: string, locale: string) =>
      Promise.resolve({ k: `${tenantId}/${locale}` }),
    );
    const { overrides } = setup(read);
    expect(await overrides.resolveOverrides('t1', 'fr')).toEqual({ k: 't1/fr' });
    expect(await overrides.resolveOverrides('t1', 'de')).toEqual({ k: 't1/de' });
    expect(await overrides.resolveOverrides('t2', 'fr')).toEqual({ k: 't2/fr' });
  });

  it('shares one read between simultaneous renders', async () => {
    let release: (value: Record<string, string>) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<Record<string, string>>((resolve) => {
          release = resolve;
        }),
    );
    const { overrides } = setup(read);
    const first = overrides.resolveOverrides('t1', 'fr');
    const second = overrides.resolveOverrides('t1', 'fr');
    release({ a: 'b' });
    expect(await first).toEqual({ a: 'b' });
    expect(await second).toEqual({ a: 'b' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('forgets a tenant when told it changed, and ignores a read that began before', async () => {
    let value = 'old';
    const read = vi.fn(() => Promise.resolve({ k: value }));
    const { overrides } = setup(read);
    await overrides.resolveOverrides('t1', 'fr');
    value = 'new';
    overrides.invalidateTenant('t1');
    expect(await overrides.resolveOverrides('t1', 'fr')).toEqual({ k: 'new' });
  });

  it('does not store a read that an invalidation overtook', async () => {
    const releases: ((value: Record<string, string>) => void)[] = [];
    const read = vi.fn(
      () =>
        new Promise<Record<string, string>>((resolve) => {
          releases.push(resolve);
        }),
    );
    const { overrides } = setup(read);
    const stale = overrides.resolveOverrides('t1', 'fr');
    overrides.invalidateTenant('t1');
    releases[0]?.({ k: 'stale' });
    await stale;
    const fresh = overrides.resolveOverrides('t1', 'fr');
    releases[1]?.({ k: 'fresh' });
    expect(await fresh).toEqual({ k: 'fresh' });
  });

  it('answers none, never an error, when the read fails, and backs off briefly', async () => {
    const read = vi
      .fn<(tenantId: string, locale: string) => Promise<Record<string, string>>>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ k: 'v' });
    const { overrides, log, advance } = setup(read);
    expect(await overrides.resolveOverrides('t1', 'fr')).toEqual({});
    expect(log).toHaveBeenCalledTimes(1);
    expect(await overrides.resolveOverrides('t1', 'fr')).toEqual({});
    expect(read).toHaveBeenCalledTimes(1);
    advance(OVERRIDE_BACKOFF_MS);
    expect(await overrides.resolveOverrides('t1', 'fr')).toEqual({ k: 'v' });
  });

  it('answers none for a tag that is not a locale, without reading', async () => {
    const read = vi.fn(() => Promise.resolve({ k: 'v' }));
    const { overrides } = setup(read);
    expect(await overrides.resolveOverrides('t1', '../etc')).toEqual({});
    expect(read).not.toHaveBeenCalled();
  });

  it('reads under the spelling the tenant stores, whatever the caller typed', async () => {
    const read = vi.fn(() => Promise.resolve({}));
    const { overrides } = setup(read);
    await overrides.resolveOverrides('t1', 'FR-ca');
    expect(read).toHaveBeenCalledWith('t1', 'fr-CA');
  });

  it('lets reads past the in-flight bound run alone rather than queue', () => {
    const read = vi.fn(() => new Promise<Record<string, string>>(() => undefined));
    const { overrides } = setup(read);
    for (let n = 0; n < MAX_OVERRIDE_READS_IN_FLIGHT + 5; n += 1) {
      overrides.resolveOverrides(`t${String(n)}`, 'fr').catch(() => undefined);
    }
    expect(read).toHaveBeenCalledTimes(MAX_OVERRIDE_READS_IN_FLIGHT + 5);
  });
});
