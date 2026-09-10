import { type Clock } from '#/clock.js';
import { type Config } from '#/config.js';
import { OduduError } from '#/errors.js';
import { type Logger } from '#/logger.js';

export interface ModuleContext {
  readonly config: Config;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface OduduModule {
  readonly name: string;
  readonly dependsOn?: readonly string[];
  start?(ctx: ModuleContext): Promise<void>;
  stop?(): Promise<void>;
}

export class ModuleRegistry {
  readonly #modules = new Map<string, OduduModule>();
  #started: OduduModule[] = [];

  register(module: OduduModule): this {
    if (this.#modules.has(module.name)) {
      throw new OduduError('module_duplicate', `Module "${module.name}" is already registered`);
    }
    this.#modules.set(module.name, module);
    return this;
  }

  async start(ctx: ModuleContext): Promise<void> {
    for (const module of this.#resolveOrder()) {
      await module.start?.(ctx);
      this.#started.push(module);
      ctx.logger.debug({ module: module.name }, 'module started');
    }
  }

  async stop(): Promise<void> {
    const failures: unknown[] = [];

    for (const module of [...this.#started].reverse()) {
      try {
        await module.stop?.();
      } catch (error) {
        failures.push(error);
      }
    }

    this.#started = [];

    if (failures.length > 0) {
      throw new OduduError(
        'module_stop_failed',
        `${String(failures.length)} module(s) failed to stop`,
        {
          cause: new AggregateError(failures),
        },
      );
    }
  }

  #resolveOrder(): OduduModule[] {
    const ordered: OduduModule[] = [];
    const state = new Map<string, 'visiting' | 'done'>();

    const visit = (name: string, trail: readonly string[]): void => {
      if (state.get(name) === 'done') return;

      if (state.get(name) === 'visiting') {
        throw new OduduError(
          'module_cycle',
          `Module dependency cycle: ${[...trail, name].join(' -> ')}`,
        );
      }

      const module = this.#modules.get(name);
      if (!module) {
        throw new OduduError(
          'module_unknown_dependency',
          `Module "${trail.at(-1) ?? name}" depends on unregistered module "${name}"`,
        );
      }

      state.set(name, 'visiting');
      for (const dependency of module.dependsOn ?? []) {
        visit(dependency, [...trail, name]);
      }
      state.set(name, 'done');
      ordered.push(module);
    };

    for (const name of this.#modules.keys()) visit(name, []);

    return ordered;
  }
}
