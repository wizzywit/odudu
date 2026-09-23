import { type DatabaseHandle } from '@odudu/db';
import { type Config, type OduduModule } from '@odudu/kernel';
import {
  reap,
  retentionPolicyFromConfig,
  type ReapDeps,
  type ReapOutcome,
  type RetentionPolicy,
} from '#/cli/reap';
import { startScheduler, type Scheduler } from '#/scheduler';

/**
 * How much of the interval the jitter adds on top, so replicas that booted
 * from the same deployment stop contending for the retention lock in the
 * same second. One of them wins and the rest skip, so contention costs
 * nothing but noise — which is why this is a tenth and not a half.
 */
export const REAP_JITTER_FRACTION = 0.1;

export type ReapScheduleDecision =
  | { readonly scheduled: true; readonly intervalMs: number; readonly jitterMs: number }
  | { readonly scheduled: false; readonly why: 'switched-off' | 'no-serving-connection' };

/**
 * Whether this process reaps on a timer, decided once at boot. Without
 * `ODUDU_APP_DATABASE_URL` the pass refuses outright — in every
 * environment, not only production, since its deletes are scoped by a
 * policy the owner role escapes — so there is nothing to schedule. The
 * production boot guard rejects that configuration before this is reached;
 * outside production the server keeps serving and says why it is not
 * reaping.
 */
export function reapSchedule(config: Config): ReapScheduleDecision {
  if (!config.ODUDU_REAP_ENABLED) return { scheduled: false, why: 'switched-off' };
  if (config.ODUDU_APP_DATABASE_URL === undefined) {
    return { scheduled: false, why: 'no-serving-connection' };
  }
  const intervalMs = config.ODUDU_REAP_INTERVAL_SECONDS * 1000;
  return { scheduled: true, intervalMs, jitterMs: intervalMs * REAP_JITTER_FRACTION };
}

export interface ReapModuleDeps {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
}

/**
 * The pass the schedule drives. Defaulted rather than injected in
 * `main.ts`, the way `assertReapOrder`'s order is, so a test can drive one
 * tick of the wiring without a database and production has one answer.
 */
export type ReapPass = (deps: ReapDeps, now: Date, policy: RetentionPolicy) => Promise<ReapOutcome>;

export function reapModule(deps: ReapModuleDeps, pass: ReapPass = reap): OduduModule {
  let scheduler: Scheduler | undefined;

  return {
    name: 'reap',
    dependsOn: ['database'],

    start: (ctx) => {
      const decision = reapSchedule(ctx.config);
      if (!decision.scheduled) {
        if (decision.why === 'switched-off') {
          ctx.logger.info(
            {},
            'ODUDU_REAP_ENABLED=false: nothing here deletes expired state, so ' +
              'schedule `odudu reap` externally',
          );
        } else {
          ctx.logger.warn(
            {},
            'not reaping: ODUDU_APP_DATABASE_URL is unset, and the pass ' +
              'deletes under the tenant policy the owner role escapes — set it, or set ' +
              'ODUDU_REAP_ENABLED=false to say the schedule lives elsewhere',
          );
        }
        return Promise.resolve();
      }

      const log = ctx.logger.child({ module: 'reap' });
      scheduler = startScheduler({
        intervalMs: decision.intervalMs,
        jitterMs: decision.jitterMs,
        log,
        run: async () => {
          const outcome = await pass(deps, ctx.clock.now(), retentionPolicyFromConfig(ctx.config));
          if (outcome.ran) log.info({ deleted: outcome.deleted }, 'retention pass complete');
          else log.info({ reason: outcome.reason }, 'retention pass skipped');
        },
      });
      ctx.logger.info(
        { intervalSeconds: ctx.config.ODUDU_REAP_INTERVAL_SECONDS },
        'reaping expired state on a schedule',
      );
      return Promise.resolve();
    },

    stop: async () => {
      await scheduler?.stop();
    },
  };
}
