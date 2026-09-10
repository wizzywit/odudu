import { describe, expect, it } from 'vitest';
import { FakeClock } from '#/clock';
import { loadConfig } from '#/config';
import { OduduError } from '#/errors';
import { type Logger } from '#/logger';
import { ModuleRegistry, type OduduModule } from '#/registry';

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

  it('reports a self-dependency cycle as a single node', async () => {
    const registry = new ModuleRegistry().register({ name: 'a', dependsOn: ['a'] });
    await expect(registry.start(context())).rejects.toThrow(/a -> a/);
  });

  it('trims the cycle trail to the cycle, excluding any non-cycle prefix', async () => {
    const registry = new ModuleRegistry()
      .register({ name: 'x', dependsOn: ['a'] })
      .register({ name: 'a', dependsOn: ['b'] })
      .register({ name: 'b', dependsOn: ['a'] });

    const error: unknown = await registry.start(context()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/a -> b -> a/);
    expect((error as Error).message).not.toContain('x -> ');
  });

  it('stops every remaining module even when one throws or rejects', async () => {
    const log: string[] = [];
    const registry = new ModuleRegistry()
      .register(recorder('db', log))
      .register({
        name: 'http',
        dependsOn: ['db'],
        start: () => Promise.resolve(),
        stop: () => Promise.reject(new Error('socket stuck')),
      })
      .register({
        name: 'cache',
        dependsOn: ['db'],
        start: () => Promise.resolve(),
        stop: () => {
          throw new Error('handle closed');
        },
      });

    await registry.start(context());

    const error = await registry.stop().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OduduError);
    const oduduError = error as OduduError;
    expect(oduduError.code).toBe('module_stop_failed');
    expect(oduduError.cause).toBeInstanceOf(AggregateError);
    const aggregate = oduduError.cause as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors.map((e: Error) => e.message)).toEqual(
      expect.arrayContaining(['socket stuck', 'handle closed']),
    );
    expect(log).toContain('stop:db');
  });
});
