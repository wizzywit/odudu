import type { AssistantMode } from '@odudu/contracts/admin';
import type { Slot } from '#/service/slots';

export const LEVEL_NAMES = ['tenant_month', 'admin_day', 'conversation', 'turn'] as const;
export type LevelName = (typeof LEVEL_NAMES)[number];

// One spend limit a reservation counts against. windowStart names the window
// the counter belongs to: a counter holding an older window starts over.
export interface LevelLimit {
  readonly level: LevelName;
  readonly scopeKey: string;
  readonly slot: Slot | null;
  readonly limitTokens: number;
  readonly windowStart: Date;
}

/**
 * What a tenant may use of the assistant. The open product fills it from the
 * tenant's settings; a paid layer may fill it from a plan.
 */
export interface AssistantLimits {
  readonly monthlyTokensBySlot: Readonly<Record<Slot, number>>;
  /** Models a person may pick; empty means the ones the operator configured. */
  readonly allowedModels: readonly string[];
  readonly toolClasses: readonly string[];
  readonly modes: readonly AssistantMode[];
  readonly maxConcurrent: number;
  readonly maxStepsPerTurn: number;
}

export type StopReason =
  | 'done'
  | 'step_cap'
  | 'awaiting_approval'
  | 'budget_turn'
  | 'budget_conversation'
  | 'budget_admin'
  | 'budget_tenant'
  | 'aborted'
  | 'error';

// An administrator's share of a tenant's month for one slot, per UTC day.
export const ADMIN_DAY_PERCENT = 25;
// What one conversation may spend in a UTC month, and one turn in all.
export const CONVERSATION_TOKEN_LIMIT = 2_000_000;
export const TURN_TOKEN_LIMIT = 1_000_000;
// The share of a level used at which the panel says so.
export const WARN_PERCENT = 80;

export interface LevelContext {
  readonly tenantId: string;
  readonly ownerSubjectId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly slot: Slot;
  readonly limits: AssistantLimits;
  readonly now: Date;
  readonly turnStartedAt: Date;
}

function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

function dayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** The four limits one model call is reserved against, in the order they are counted. */
export function levelLimitsFor(context: LevelContext): LevelLimit[] {
  const monthly = context.limits.monthlyTokensBySlot[context.slot];
  return [
    {
      level: 'tenant_month',
      scopeKey: context.tenantId,
      slot: context.slot,
      limitTokens: monthly,
      windowStart: monthStart(context.now),
    },
    {
      level: 'admin_day',
      scopeKey: context.ownerSubjectId,
      slot: context.slot,
      limitTokens: Math.ceil((monthly * ADMIN_DAY_PERCENT) / 100),
      windowStart: dayStart(context.now),
    },
    {
      level: 'conversation',
      scopeKey: context.conversationId,
      slot: null,
      limitTokens: CONVERSATION_TOKEN_LIMIT,
      windowStart: monthStart(context.now),
    },
    {
      level: 'turn',
      scopeKey: context.turnId,
      slot: null,
      limitTokens: TURN_TOKEN_LIMIT,
      windowStart: context.turnStartedAt,
    },
  ];
}

export interface Refusal {
  readonly level: LevelName;
  readonly stopReason: Extract<
    StopReason,
    'budget_turn' | 'budget_conversation' | 'budget_admin' | 'budget_tenant'
  >;
}

const STOP_OF_LEVEL: Record<LevelName, Refusal['stopReason']> = {
  tenant_month: 'budget_tenant',
  admin_day: 'budget_admin',
  conversation: 'budget_conversation',
  turn: 'budget_turn',
};

/**
 * What the person is told when a level refuses a call: the level, the model
 * slot where it is per slot, and who can change it. Nothing here offers a
 * cheaper model; the turn simply ends.
 */
export function refusalFor(
  level: LevelName,
  slot: Slot,
): { readonly stopReason: Refusal['stopReason']; readonly message: string } {
  const messages: Record<LevelName, string> = {
    tenant_month:
      `This tenant has used its monthly allowance for the ${slot} model, so the assistant stopped. ` +
      'A tenant administrator with manage-assistant can raise it in Settings, under Console assistant; ' +
      'it starts over at the beginning of the next month, UTC.',
    admin_day:
      `You have used your share of today's ${slot} model allowance, so the assistant stopped. ` +
      'It is a quarter of the tenant’s monthly allowance, and starts over at midnight UTC. ' +
      'A tenant administrator with manage-assistant can raise the monthly allowance in Settings.',
    conversation:
      'This conversation has reached the most it may use in a month, so the assistant stopped. ' +
      'Start a new conversation to carry on. This limit is built into Odudu and has no setting.',
    turn:
      'This answer reached the most one answer may use, so the assistant stopped part way. ' +
      'Ask again, with a narrower question, to continue. This limit is built into Odudu and has no setting.',
  };
  return { stopReason: STOP_OF_LEVEL[level], message: messages[level] };
}

export function refusalOf(level: LevelName): Refusal {
  return { level, stopReason: STOP_OF_LEVEL[level] };
}

export interface LevelUsage {
  readonly level: LevelName;
  readonly used: number;
  readonly limit: number;
}

/** The levels at or past the warning share, each with its percent of the limit (at most 100). */
export function warnedLevels(
  usage: readonly LevelUsage[],
): { level: LevelName; percent: number }[] {
  return usage
    .filter((entry) => entry.limit > 0 && (entry.used * 100) / entry.limit >= WARN_PERCENT)
    .map((entry) => ({
      level: entry.level,
      percent: Math.min(100, Math.floor((entry.used * 100) / entry.limit)),
    }));
}

export interface TurnEnding {
  readonly refused: Refusal | undefined;
  readonly aborted: boolean;
  readonly failed: boolean;
  readonly steps: number;
  readonly maxSteps: number;
  readonly lastFinish: string | undefined;
  // The turn stopped on a change that waits for the person to decide.
  readonly awaitingApproval?: boolean;
}

/** Why a turn ended, in the one vocabulary the panel and the audit row share. */
export function stopReasonOf(ending: TurnEnding): StopReason {
  if (ending.refused !== undefined) return ending.refused.stopReason;
  if (ending.aborted) return 'aborted';
  if (ending.failed) return 'error';
  if (ending.awaitingApproval === true) return 'awaiting_approval';
  if (ending.lastFinish === 'tool-calls' && ending.steps >= ending.maxSteps) return 'step_cap';
  return 'done';
}

export interface CallUsage {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}

/**
 * What a finished call cost: the provider's total, else its input and output,
 * else, when it reported nothing or only zeros, the whole reservation, since a
 * call is never free for having gone unmeasured.
 */
export function actualSpend(usage: CallUsage, reserved: number): number {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const total = usage.totalTokens ?? 0;
  if (total <= 0 && input <= 0 && output <= 0) return reserved;
  return total > 0 ? total : input + output;
}

/**
 * What a reservation left open costs: all of it when the call was sent, because
 * how it ended is unknown, and nothing when it never reached the provider.
 */
export function unsettledCharge(reserved: number, sent: boolean): number {
  return sent ? reserved : 0;
}

// A reservation left open this long is the work of a process that died; the
// longest a model call may take is well inside it.
export const RESERVATION_SWEEP_AFTER_MS = 15 * 60_000;
// How long spent counters, settled reservations and lapsed leases are kept.
export const SHORT_COUNTER_RETENTION_DAYS = 2;
export const MONTHLY_COUNTER_RETENTION_DAYS = 62;
export const SETTLED_RESERVATION_RETENTION_DAYS = 7;
export const LAPSED_LEASE_RETENTION_DAYS = 1;
// The most rows of one kind a pass takes for a tenant, in rounds of this size.
export const UPKEEP_BATCH = 1000;
export const UPKEEP_MAX_ROUNDS = 10;

// A turn's place in the database lapses this long after its deadline if nothing released it.
export const LEASE_GRACE_MS = 60_000;

/** How long a lease lives: the turn's deadline and the grace after it. */
export function leaseTtlMs(deadlineMs: number): number {
  return deadlineMs + LEASE_GRACE_MS;
}

/** The steps a turn may take: the profile's cap, lowered by the tenant's when that is less. */
export function stepLimitFor(profileMaxSteps: number, tenantMaxSteps: number | undefined): number {
  return Math.min(profileMaxSteps, tenantMaxSteps ?? profileMaxSteps);
}

const DAY_MS = 86_400_000;

// A grant made for one approved change lives for the length of the call, which ends within
// the five minutes of its token. One older than this was left by a process that died.
export const WRITE_GRANT_STALE_MS = 600_000;

/** The instants before which the upkeep deletes each kind of spent row. */
export function upkeepCutoffs(now: Date): {
  readonly shortWindowsBefore: Date;
  readonly monthlyWindowsBefore: Date;
  readonly settledBefore: Date;
  readonly leasesBefore: Date;
} {
  const before = (days: number): Date => new Date(now.getTime() - days * DAY_MS);
  return {
    shortWindowsBefore: before(SHORT_COUNTER_RETENTION_DAYS),
    monthlyWindowsBefore: before(MONTHLY_COUNTER_RETENTION_DAYS),
    settledBefore: before(SETTLED_RESERVATION_RETENTION_DAYS),
    leasesBefore: before(LAPSED_LEASE_RETENTION_DAYS),
  };
}
