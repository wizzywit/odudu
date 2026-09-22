import { type DatabaseHandle } from '@odudu/db';
import { type Config, type OduduModule } from '@odudu/kernel';
import { type LogoutDeliveryTransport } from '@odudu/protocol-oidc';
import {
  logoutSenderOptionsFromConfig,
  sendLogoutsAcrossTenants,
  type LogoutSenderDeps,
  type LogoutSenderOptions,
  type LogoutSenderReport,
} from '#/cli/send-logouts';
import { startScheduler, type Scheduler } from '#/scheduler';

/**
 * How much of the interval the jitter adds on top, so replicas that booted
 * from the same deployment stop claiming in the same instant — the same
 * reasoning as `OUTBOX_JITTER_FRACTION`. `FOR UPDATE SKIP LOCKED` means two
 * senders that do meet take different rows and both make progress.
 */
export const LOGOUT_SENDER_JITTER_FRACTION = 0.1;

export type LogoutSenderScheduleDecision =
  | { readonly scheduled: true; readonly intervalMs: number; readonly jitterMs: number }
  | { readonly scheduled: false; readonly why: 'switched-off' | 'no-serving-connection' };

/**
 * Whether this process delivers back-channel logouts on a timer, decided
 * once at boot. Without `ODUDU_APP_DATABASE_URL` the pass refuses outright
 * — in every environment, not only production, since its claims are scoped
 * by a policy the owner role escapes — so there is nothing to schedule.
 * The production boot guard rejects that configuration before this is
 * reached; outside production the server keeps serving and says why no
 * relying party will be told.
 */
export function logoutSenderSchedule(config: Config): LogoutSenderScheduleDecision {
  if (!config.ODUDU_LOGOUT_SENDER_ENABLED) return { scheduled: false, why: 'switched-off' };
  if (config.ODUDU_APP_DATABASE_URL === undefined) {
    return { scheduled: false, why: 'no-serving-connection' };
  }
  const intervalMs = config.ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS * 1000;
  return { scheduled: true, intervalMs, jitterMs: intervalMs * LOGOUT_SENDER_JITTER_FRACTION };
}

export interface LogoutSenderModuleDeps {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
  readonly transport: LogoutDeliveryTransport;
}

/**
 * The pass the schedule drives. Defaulted rather than injected in
 * `main.ts`, the way the retention pass is, so a test can drive one tick
 * of the wiring without a database and production has one answer.
 */
export type LogoutSenderPass = (
  deps: LogoutSenderDeps,
  now: Date,
  options: LogoutSenderOptions,
) => Promise<LogoutSenderReport>;

export function logoutSenderModule(
  deps: LogoutSenderModuleDeps,
  pass: LogoutSenderPass = sendLogoutsAcrossTenants,
): OduduModule {
  let scheduler: Scheduler | undefined;

  return {
    name: 'logout-sender',
    dependsOn: ['database'],

    start: (ctx) => {
      const decision = logoutSenderSchedule(ctx.config);
      if (!decision.scheduled) {
        if (decision.why === 'switched-off') {
          ctx.logger.info(
            {},
            'ODUDU_LOGOUT_SENDER_ENABLED=false: nothing here delivers back-channel logouts, ' +
              'so schedule `odudu send-logouts` externally',
          );
        } else {
          ctx.logger.warn(
            {},
            'not delivering back-channel logouts: ODUDU_APP_DATABASE_URL is unset, and the ' +
              'pass claims under the tenant policy the owner role escapes — set it, or set ' +
              'ODUDU_LOGOUT_SENDER_ENABLED=false to say the schedule lives elsewhere',
          );
        }
        return Promise.resolve();
      }

      const log = ctx.logger.child({ module: 'logout-sender' });
      scheduler = startScheduler({
        intervalMs: decision.intervalMs,
        jitterMs: decision.jitterMs,
        log,
        run: async () => {
          const outcome = await pass(
            deps,
            ctx.clock.now(),
            logoutSenderOptionsFromConfig(ctx.config),
          );
          if (!outcome.ran) log.info({ reason: outcome.reason }, 'logout delivery pass skipped');
          else if (outcome.delivered > 0 || outcome.failed > 0) {
            log.info(
              { delivered: outcome.delivered, failed: outcome.failed },
              'logout delivery pass complete',
            );
          }
        },
      });
      ctx.logger.info(
        { intervalSeconds: ctx.config.ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS },
        'delivering back-channel logouts on a schedule',
      );
      return Promise.resolve();
    },

    stop: async () => {
      await scheduler?.stop();
    },
  };
}
