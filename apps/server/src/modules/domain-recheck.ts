import { type DatabaseHandle } from '@odudu/db';
import { type Config, type OduduModule } from '@odudu/kernel';
import {
  domainRecheckOptionsFromConfig,
  recheckDomainsLocked,
  type DomainRecheckDeps,
  type DomainRecheckOptions,
  type DomainRecheckOutcome,
} from '#/cli/domains';
import { startScheduler, type Scheduler } from '#/scheduler';

/** The same tenth the retention pass adds, for the same reason. */
export const DOMAIN_RECHECK_JITTER_FRACTION = 0.1;

export type DomainRecheckScheduleDecision =
  | {
      readonly scheduled: true;
      readonly intervalMs: number;
      readonly jitterMs: number;
      readonly options: DomainRecheckOptions;
    }
  | {
      readonly scheduled: false;
      readonly why: 'switched-off' | 'no-serving-connection' | 'no-base-url';
    };

/**
 * Whether this process rechecks domains on a timer, decided once at boot.
 * Neither a missing serving connection (the writes run under the tenant
 * policy) nor a missing public base URL (no domain can be registered, and
 * the fall-back needs the path address) can change from one tick to the
 * next, so either one leaves nothing to schedule.
 */
export function domainRecheckSchedule(config: Config): DomainRecheckScheduleDecision {
  if (!config.ODUDU_DOMAIN_RECHECK_ENABLED) return { scheduled: false, why: 'switched-off' };
  const options = domainRecheckOptionsFromConfig(config);
  if (options === undefined) return { scheduled: false, why: 'no-base-url' };
  if (config.ODUDU_APP_DATABASE_URL === undefined) {
    return { scheduled: false, why: 'no-serving-connection' };
  }
  const intervalMs = config.ODUDU_DOMAIN_RECHECK_INTERVAL_SECONDS * 1000;
  return {
    scheduled: true,
    intervalMs,
    jitterMs: intervalMs * DOMAIN_RECHECK_JITTER_FRACTION,
    options,
  };
}

export interface DomainRecheckModuleDeps {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
}

export type DomainRecheckPass = (
  deps: DomainRecheckDeps,
  now: Date,
  options: DomainRecheckOptions,
) => Promise<DomainRecheckOutcome>;

const NO_SERVING_CONNECTION =
  'not rechecking domains: ODUDU_APP_DATABASE_URL is unset, and the pass writes under the ' +
  'tenant policy the owner role escapes — set it, or set ODUDU_DOMAIN_RECHECK_ENABLED=false';

// Quiet because without a base URL no domain can be registered, so a deployment
// that never uses domains has nothing to recheck and nothing to be told.
const NO_BASE_URL =
  'not rechecking domains: ODUDU_PUBLIC_BASE_URL is unset, so no domain can be served';

export function domainRecheckModule(
  deps: DomainRecheckModuleDeps,
  pass: DomainRecheckPass = recheckDomainsLocked,
): OduduModule {
  let scheduler: Scheduler | undefined;

  return {
    name: 'domain-recheck',
    dependsOn: ['database'],

    start: (ctx) => {
      const decision = domainRecheckSchedule(ctx.config);
      if (!decision.scheduled) {
        if (decision.why === 'switched-off') {
          ctx.logger.info(
            {},
            'ODUDU_DOMAIN_RECHECK_ENABLED=false: nothing here notices a domain that stops ' +
              'proving ownership, so schedule `odudu domains recheck` externally',
          );
        } else if (decision.why === 'no-base-url') {
          ctx.logger.info({}, NO_BASE_URL);
        } else {
          ctx.logger.warn({}, NO_SERVING_CONNECTION);
        }
        return Promise.resolve();
      }

      const log = ctx.logger.child({ module: 'domain-recheck' });
      scheduler = startScheduler({
        intervalMs: decision.intervalMs,
        jitterMs: decision.jitterMs,
        log,
        run: async () => {
          const outcome = await pass(deps, ctx.clock.now(), {
            ...decision.options,
            onRowError: (row, err) => {
              log.error(
                { err, tenantId: row.tenantId, host: row.host },
                'a domain could not be rechecked; the pass went on',
              );
            },
          });
          if (outcome.ran) {
            const { checked, failed, indeterminate, fellBack, errored } = outcome;
            log.info(
              { checked, failed, indeterminate, fellBack, errored },
              'domain recheck complete',
            );
          } else {
            log.info({ reason: outcome.reason }, 'domain recheck skipped');
          }
        },
      });
      ctx.logger.info(
        { intervalSeconds: ctx.config.ODUDU_DOMAIN_RECHECK_INTERVAL_SECONDS },
        'rechecking custom domains on a schedule',
      );
      return Promise.resolve();
    },

    stop: async () => {
      await scheduler?.stop();
    },
  };
}
