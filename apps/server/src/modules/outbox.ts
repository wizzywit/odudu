import { type DatabaseHandle } from '@odudu/db';
import {
  sendPending,
  type EmailSender,
  type SendPendingDeps,
  type SendPendingOptions,
  type SendPendingOutcome,
} from '@odudu/email';
import { type Config, type OduduModule } from '@odudu/kernel';
import { outboxOptionsFromConfig } from '#/cli/send-mail';
import { startScheduler, type Scheduler } from '#/scheduler';

/**
 * How much of the interval the jitter adds on top, so replicas that booted
 * from the same deployment stop claiming in the same instant. `FOR UPDATE
 * SKIP LOCKED` means two senders that do meet take different messages and
 * both make progress, so contention costs nothing but wasted queries —
 * which is why this is a tenth and not a half.
 */
export const OUTBOX_JITTER_FRACTION = 0.1;

export type OutboxScheduleDecision =
  | { readonly scheduled: true; readonly intervalMs: number; readonly jitterMs: number }
  | { readonly scheduled: false; readonly why: 'switched-off' | 'no-serving-connection' };

/**
 * Whether this process sends queued mail on a timer, decided once at boot.
 * Without `ODUDU_APP_DATABASE_URL` the pass refuses outright — in every
 * environment, not only production, since its claims are scoped by a policy
 * the owner role escapes — so there is nothing to schedule. The production
 * boot guard rejects that configuration before this is reached; outside
 * production the server keeps serving and says why no mail will go out.
 */
export function outboxSchedule(config: Config): OutboxScheduleDecision {
  if (!config.ODUDU_OUTBOX_ENABLED) return { scheduled: false, why: 'switched-off' };
  if (config.ODUDU_APP_DATABASE_URL === undefined) {
    return { scheduled: false, why: 'no-serving-connection' };
  }
  const intervalMs = config.ODUDU_OUTBOX_INTERVAL_SECONDS * 1000;
  return { scheduled: true, intervalMs, jitterMs: intervalMs * OUTBOX_JITTER_FRACTION };
}

export interface OutboxModuleDeps {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
  readonly sender: EmailSender;
}

/**
 * The pass the schedule drives. Defaulted rather than injected in
 * `main.ts`, the way the retention pass is, so a test can drive one tick of
 * the wiring without a database and production has one answer.
 */
export type OutboxPass = (
  deps: SendPendingDeps,
  now: Date,
  options: SendPendingOptions,
) => Promise<SendPendingOutcome>;

export function outboxModule(deps: OutboxModuleDeps, pass: OutboxPass = sendPending): OduduModule {
  let scheduler: Scheduler | undefined;

  return {
    name: 'outbox',
    dependsOn: ['database'],

    start: (ctx) => {
      const decision = outboxSchedule(ctx.config);
      if (!decision.scheduled) {
        if (decision.why === 'switched-off') {
          ctx.logger.info(
            {},
            'ODUDU_OUTBOX_ENABLED=false: nothing here sends queued mail, so ' +
              'schedule `odudu send-mail` externally',
          );
        } else {
          ctx.logger.warn(
            {},
            'not sending queued mail: ODUDU_APP_DATABASE_URL is unset, and the pass ' +
              'claims under the realm policy the owner role escapes — set it, or set ' +
              'ODUDU_OUTBOX_ENABLED=false to say the schedule lives elsewhere',
          );
        }
        return Promise.resolve();
      }

      const log = ctx.logger.child({ module: 'outbox' });
      scheduler = startScheduler({
        intervalMs: decision.intervalMs,
        jitterMs: decision.jitterMs,
        log,
        run: async () => {
          const outcome = await pass(
            { ...deps, log },
            ctx.clock.now(),
            outboxOptionsFromConfig(ctx.config),
          );
          if (!outcome.ran) log.info({ reason: outcome.reason }, 'outbox pass skipped');
          else if (outcome.sent > 0 || outcome.failed > 0) {
            log.info({ sent: outcome.sent, failed: outcome.failed }, 'outbox pass complete');
          }
        },
      });
      ctx.logger.info(
        { intervalSeconds: ctx.config.ODUDU_OUTBOX_INTERVAL_SECONDS },
        'sending queued mail on a schedule',
      );
      return Promise.resolve();
    },

    stop: async () => {
      await scheduler?.stop();
    },
  };
}
