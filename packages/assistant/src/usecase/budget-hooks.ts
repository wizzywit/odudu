import { budgetRepository } from '#/repository/budgets';
import type { AssistantTx } from '#/repository/tx';
import { inputUpperBound } from '#/service/estimate';
import {
  actualSpend,
  levelLimitsFor,
  refusalFor,
  refusalOf,
  unsettledCharge,
  warnedLevels,
  type CallUsage,
  type AssistantLimits,
  type LevelName,
  type Refusal,
} from '#/service/limits';
import { reservationTokens, type RequestParts } from '#/service/request-size';
import type { Slot } from '#/service/slots';

/** Raised by the loop's `prepareStep` when a level refuses the next model call. */
export class BudgetRefused extends Error {
  readonly refusal: Refusal;
  readonly slot: Slot;

  constructor(refusal: Refusal, slot: Slot) {
    super(refusalFor(refusal.level, slot).message);
    this.name = 'BudgetRefused';
    this.refusal = refusal;
    this.slot = slot;
  }
}

/** What the loop needs of a turn's budget: three calls around each model call. */
export interface TurnBudgetPort {
  beforeCall(request: RequestParts): Promise<void>;
  markSent(): Promise<void>;
  afterCall(usage: CallUsage): Promise<void>;
}

export interface BudgetWarning {
  readonly level: LevelName;
  readonly percent: number;
  readonly slot: Slot;
}

export interface TurnBudgetDeps {
  readonly transact: <T>(fn: (tx: AssistantTx) => Promise<T>) => Promise<T>;
  readonly now: () => Date;
  readonly limits: AssistantLimits;
  readonly tenantId: string;
  readonly ownerSubjectId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly slot: Slot;
  readonly onWarning: (warning: BudgetWarning) => void;
  /** Tokens a provider charged beyond what was reserved, once settled. */
  readonly onOverrun: (tokens: number) => void;
}

export interface TurnBudget extends TurnBudgetPort {
  /** Settles a reservation the loop left open: an error or an abort ended the call. */
  finish(): Promise<void>;
  /** The level that refused a call, if one did. */
  refused(): Refusal | undefined;
  /** The tokens settled against the ledger so far, for the turn's audit row. */
  charged(): number;
}

interface Open {
  readonly id: string;
  readonly reserved: number;
  sent: boolean;
}

/**
 * One turn's use of the ledger. A call is reserved before it is made, at the
 * input upper bound plus the most it may answer with; when it ends, the
 * provider's own count replaces the reservation. A reservation left open by an
 * error or an abort is settled at its full size when the call was sent, because
 * what it cost is unknown, and at nothing when it was not. Each step is its own
 * short transaction: none is held while the model runs.
 */
export function createTurnBudget(deps: TurnBudgetDeps): TurnBudget {
  let open: Open | undefined;
  let carried = 0;
  let spent = 0;
  let previous: { inputTokens: number; messagesBytes: number } | undefined;
  let refusal: Refusal | undefined;
  const warned = new Set<LevelName>();
  // Settling and reserving never overlap, so a late callback cannot settle the next call's hold.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  const levelsAt = (at: Date, turnStartedAt: Date) =>
    levelLimitsFor({
      tenantId: deps.tenantId,
      ownerSubjectId: deps.ownerSubjectId,
      conversationId: deps.conversationId,
      turnId: deps.turnId,
      slot: deps.slot,
      limits: deps.limits,
      now: at,
      turnStartedAt,
    });
  const startedAt = deps.now();

  async function settle(actual: (reserved: number, sent: boolean) => number): Promise<void> {
    const held = open;
    if (held === undefined) return;
    open = undefined;
    const at = deps.now();
    const { overrun, usage } = await deps.transact(async (tx) => {
      const repo = budgetRepository(tx);
      const charge = actual(held.reserved, held.sent);
      const settled = await repo.settle(held.id, charge);
      spent += charge;
      return { overrun: settled.overrun, usage: await repo.usage(levelsAt(at, startedAt)) };
    });
    if (overrun > 0) deps.onOverrun(overrun);
    for (const warning of warnedLevels(usage)) {
      if (warned.has(warning.level)) continue;
      warned.add(warning.level);
      deps.onWarning({ ...warning, slot: deps.slot });
    }
  }

  return {
    beforeCall: (request) =>
      serial(async () => {
        await settle(unsettledCharge);
        const at = deps.now();
        carried = inputUpperBound(request.messages);
        const tokens = reservationTokens({
          fixedBytes: inputUpperBound(request.fixed),
          messagesBytes: carried,
          ...(previous === undefined ? {} : { previous }),
        });
        const reserved = await deps.transact((tx) =>
          budgetRepository(tx).reserve({
            turnId: deps.turnId,
            slot: deps.slot,
            tokens,
            levels: levelsAt(at, startedAt),
            now: at,
          }),
        );
        if (!reserved.ok) {
          refusal = refusalOf(reserved.level);
          throw new BudgetRefused(refusal, deps.slot);
        }
        open = { id: reserved.reservationId, reserved: tokens, sent: false };
      }),

    markSent: () =>
      serial(async () => {
        const held = open;
        if (held === undefined || held.sent) return;
        held.sent = true;
        await deps.transact((tx) => budgetRepository(tx).markSent(held.id));
      }),

    afterCall: (usage) =>
      serial(() => {
        if ((usage.inputTokens ?? 0) > 0) {
          previous = { inputTokens: usage.inputTokens ?? 0, messagesBytes: carried };
        }
        return settle((reserved) => actualSpend(usage, reserved));
      }),

    finish: () => serial(() => settle(unsettledCharge)),

    refused: () => refusal,

    charged: () => spent,
  };
}
