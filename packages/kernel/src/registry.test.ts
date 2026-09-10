import { describe, expect, it } from 'vitest';
import { FakeClock } from '#/clock.js';
import { loadConfig } from '#/config.js';
import { OduduError } from '#/errors.js';
import { type Logger } from '#/logger.js';
import { ModuleRegistry, type OduduModule } from '#/registry.js';

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};

function context() {
  return {
    config: loadConfig({ ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu' }),
    clock: new FakeClock(new Date('2026-01-01T00:00:00.000Z')),
    logger: noopLogger,
  };
}

function recorder(name: string, log: string[], dependsOn?: readonly string[]): OduduModule {
  return {
    name,
    ...(dependsOn ? { dependsOn } : {}),
    start: () => {
      log.push(`start:${name}`);
      return Promise.resolve();
    },
    stop: () => {
      log.push(`stop:${name}`);
      return Promise.resolve();
    },
  };
}

describe('ModuleRegistry', () => {
  it('starts modules in dependency order', async () => {
    const log: string[] = [];
    const registry = new ModuleRegistry()
      .register(recorder('http', log, ['db']))
      .register(recorder('db', log));

    await registry.start(context());

    expect(log).toEqual(['start:db', 'start:http']);
  });

  it('stops modules in reverse start order', async () => {
    const log: string[] = [];
    const registry = new ModuleRegistry()
      .register(recorder('http', log, ['db']))
      .register(recorder('db', log));

    await registry.start(context());
    log.length = 0;
    await registry.stop();

    expect(log).toEqual(['stop:http', 'stop:db']);
  });

  it('rejects a duplicate module name', () => {
    const registry = new ModuleRegistry().register({ name: 'db' });
    expect(() => registry.register({ name: 'db' })).toThrow(OduduError);
  });

  it('rejects an unknown dependency', async () => {
    const registry = new ModuleRegistry().register({ name: 'http', dependsOn: ['nope'] });
    await expect(registry.start(context())).rejects.toThrow(/nope/);
  });

  it('rejects a dependency cycle', async () => {
    const registry = new ModuleRegistry()
      .register({ name: 'a', dependsOn: ['b'] })
      .register({ name: 'b', dependsOn: ['a'] });
    await expect(registry.start(context())).rejects.toThrow(/cycle/i);
  });

  it('stops every remaining module even when one throws', async () => {
    const log: string[] = [];
    const registry = new ModuleRegistry().register(recorder('db', log)).register({
      name: 'http',
      dependsOn: ['db'],
      start: () => Promise.resolve(),
      stop: () => {
        throw new Error('socket stuck');
      },
    });

    await registry.start(context());
    await expect(registry.stop()).rejects.toThrow(OduduError);
    expect(log).toContain('stop:db');
  });
});
