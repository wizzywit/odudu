// The token ledger. A caller reserves max output plus the input upper bound,
// because a sent reservation that is never settled is charged as reserved and
// an under-sized one under-counts. sweep resolves at most MAX_LIMIT per call,
// so a caller loops it while released + charged equals that bound. prune
// deletes what no decision can still read, a bounded batch of each at a time.
import { MAX_LIMIT } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { sql, type SQL } from 'drizzle-orm';
import { type AssistantTx } from '#/repository/tx';
import { LEVEL_NAMES, type LevelLimit, type LevelName, type LevelUsage } from '#/service/limits';
import { type Slot } from '#/service/slots';

export { LEVEL_NAMES, type LevelLimit, type LevelName } from '#/service/limits';

export interface ReserveInput {
  readonly turnId: string;
  readonly slot: Slot;
  readonly tokens: number;
  readonly levels: readonly LevelLimit[];
  readonly now: Date;
}

export type ReserveResult = { ok: true; reservationId: string } | { ok: false; level: LevelName };

interface ChargedLevel {
  level: LevelName;
  scopeKey: string;
  slot: Slot | null;
  windowStart: string;
}

interface Refund {
  level: ChargedLevel;
  tokens: number;
}

interface OpenReservation extends Record<string, unknown> {
  id: string;
  reserved: string;
  sent: boolean;
  levels: ChargedLevel[];
}

const WINDOW_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

function whole(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number of at least zero`);
  }
  return Math.ceil(value);
}

// Locks are taken in this order by every caller, so two reservations that
// share counters wait on each other instead of deadlocking.
function inLockOrder(levels: readonly LevelLimit[]): LevelLimit[] {
  const ordered = [...levels].sort(
    (a, b) => LEVEL_NAMES.indexOf(a.level) - LEVEL_NAMES.indexOf(b.level),
  );
  if (
    ordered.length === 0 ||
    new Set(ordered.map((entry) => entry.level)).size !== ordered.length
  ) {
    throw new RangeError('a reservation needs at least one level and names each level once');
  }
  return ordered;
}

function counterMatches(level: ChargedLevel) {
  return sql`tenant_id = ${TENANT}
    and scope_kind = ${level.level}
    and scope_key = ${level.scopeKey}
    and coalesce(slot, '') = ${level.slot ?? ''}`;
}

export interface PruneCutoffs {
  // Counters of the short levels (turn, administrator day) whose window began before this.
  readonly shortWindowsBefore: Date;
  // Counters of the monthly levels (tenant, conversation) whose window began before this.
  readonly monthlyWindowsBefore: Date;
  readonly settledBefore: Date;
}

export interface PruneReport {
  readonly counters: number;
  readonly reservations: number;
}

// Each deletes the oldest `batch` rows past its cutoff for the bound tenant,
// found through the index named beside it, so a pass costs the batch and not
// the table.
export function pruneStatements(
  cutoffs: PruneCutoffs,
  batch: number,
): { counters: SQL[]; reservations: SQL } {
  const counters = (kinds: readonly LevelName[], before: Date): SQL => sql`
    delete from assistant_budget_counters
     where ctid in (
       select ctid from assistant_budget_counters
        where tenant_id = ${TENANT}
          and scope_kind in (${sql.join(
            kinds.map((kind) => sql`${kind}`),
            sql`, `,
          )})
          and window_start < ${before.toISOString()}::timestamptz
        limit ${batch})`;
  return {
    counters: [
      counters(['turn', 'admin_day'], cutoffs.shortWindowsBefore),
      counters(['tenant_month', 'conversation'], cutoffs.monthlyWindowsBefore),
    ],
    reservations: sql`
      delete from assistant_reservations
       where ctid in (
         select ctid from assistant_reservations
          where tenant_id = ${TENANT} and settled
            and created_at < ${cutoffs.settledBefore.toISOString()}::timestamptz
          order by created_at
          limit ${batch})`,
  };
}

export function budgetRepository(tx: AssistantTx) {
  async function adjust(levels: readonly ChargedLevel[], delta: number): Promise<void> {
    for (const level of levels) {
      await tx.execute(sql`
        update assistant_budget_counters
           set used = greatest(used + ${delta}::bigint, 0)
         where ${counterMatches(level)}
           and window_start = ${level.windowStart}::timestamptz`);
    }
  }

  // One reservation's counters are already in lock order, but a batch of them
  // is not: the sum per counter is applied in a single global order, so a
  // concurrent reserve never waits on a counter this batch holds while this
  // batch waits on one that reserve holds.
  async function refundInLockOrder(refunds: readonly Refund[]): Promise<void> {
    const sums = new Map<string, Refund>();
    for (const { level, tokens } of refunds) {
      const key = JSON.stringify([
        level.level,
        level.scopeKey,
        level.slot ?? '',
        level.windowStart,
      ]);
      const known = sums.get(key);
      sums.set(key, { level, tokens: (known?.tokens ?? 0) + tokens });
    }
    const ordered = [...sums.values()].sort(
      (a, b) =>
        LEVEL_NAMES.indexOf(a.level.level) - LEVEL_NAMES.indexOf(b.level.level) ||
        a.level.scopeKey.localeCompare(b.level.scopeKey, 'en') ||
        (a.level.slot ?? '').localeCompare(b.level.slot ?? '', 'en'),
    );
    for (const { level, tokens } of ordered) await adjust([level], -tokens);
  }

  // Returns the window the counter holds after the charge, which is newer than
  // the caller's when the caller's clock is behind; null when the level refuses.
  async function charge(limit: LevelLimit, tokens: number): Promise<string | null> {
    const windowStart = limit.windowStart.toISOString();
    await tx.execute(sql`
      insert into assistant_budget_counters
        (tenant_id, scope_kind, scope_key, slot, used, limit_tokens, window_start)
      values (${TENANT}, ${limit.level}, ${limit.scopeKey}, ${limit.slot}, 0,
              ${limit.limitTokens}::bigint, ${windowStart}::timestamptz)
      on conflict (tenant_id, scope_kind, scope_key, (coalesce(slot, ''))) do nothing`);
    const rows = await tx.execute<{ window_start: string }>(sql`
      update assistant_budget_counters
         set used = case when window_start < ${windowStart}::timestamptz
                         then ${tokens}::bigint else used + ${tokens}::bigint end,
             window_start = greatest(window_start, ${windowStart}::timestamptz),
             limit_tokens = ${limit.limitTokens}::bigint
       where ${counterMatches({ ...limit, windowStart })}
         and (case when window_start < ${windowStart}::timestamptz then 0 else used end)
             + ${tokens}::bigint <= ${limit.limitTokens}::bigint
      returning to_char(window_start at time zone 'UTC', ${WINDOW_FORMAT}) as window_start`);
    return rows[0]?.window_start ?? null;
  }

  return {
    // What the levels hold now, for the warning; a level with no counter yet
    // holds nothing and is left out.
    async usage(levels: readonly LevelLimit[]): Promise<LevelUsage[]> {
      const found: LevelUsage[] = [];
      for (const level of levels) {
        const windowStart = level.windowStart.toISOString();
        const rows = await tx.execute<{ used: string; limit_tokens: string }>(sql`
          select used::text as used, limit_tokens::text as limit_tokens
            from assistant_budget_counters
           where ${counterMatches({ ...level, windowStart })}
             and window_start = ${windowStart}::timestamptz`);
        const row = rows[0];
        if (row !== undefined) {
          found.push({
            level: level.level,
            used: Number(row.used),
            limit: Number(row.limit_tokens),
          });
        }
      }
      return found;
    },

    async prune(cutoffs: PruneCutoffs, batch: number): Promise<PruneReport> {
      const statements = pruneStatements(cutoffs, batch);
      let counters = 0;
      for (const statement of statements.counters) counters += (await tx.execute(statement)).count;
      return { counters, reservations: (await tx.execute(statements.reservations)).count };
    },

    // Every level is charged in this transaction, so a refusal at a later
    // level gives back what the earlier ones took before the caller commits.
    async reserve(input: ReserveInput): Promise<ReserveResult> {
      const tokens = whole(input.tokens, 'tokens');
      const charged: ChargedLevel[] = [];
      for (const limit of inLockOrder(input.levels)) {
        const windowStart = await charge(limit, tokens);
        if (windowStart === null) {
          await adjust(charged, -tokens);
          return { ok: false, level: limit.level };
        }
        charged.push({
          level: limit.level,
          scopeKey: limit.scopeKey,
          slot: limit.slot,
          windowStart,
        });
      }
      const reservationId = newId();
      await tx.execute(sql`
        insert into assistant_reservations
          (tenant_id, id, turn_id, slot, reserved, levels, created_at)
        values (${TENANT}, ${reservationId}, ${input.turnId}, ${input.slot}, ${tokens}::bigint,
                ${JSON.stringify(charged)}::jsonb, ${input.now.toISOString()}::timestamptz)`);
      return { ok: true, reservationId };
    },

    async markSent(id: string): Promise<boolean> {
      const rows = await tx.execute(sql`
        update assistant_reservations set sent = true
         where tenant_id = ${TENANT} and id = ${id} and not settled
        returning 1`);
      return rows.length === 1;
    },

    // The actual spend replaces the reservation at every level it was charged
    // to; an actual above it is charged anyway, and the overrun reported.
    async settle(id: string, actual: number): Promise<{ overrun: number }> {
      const spent = whole(actual, 'actual');
      const [open] = await tx.execute<OpenReservation>(sql`
        select id, reserved::text as reserved, sent, levels
          from assistant_reservations
         where tenant_id = ${TENANT} and id = ${id} and not settled
           for update`);
      if (open === undefined) return { overrun: 0 };
      const reserved = Number(open.reserved);
      await adjust(open.levels, spent - reserved);
      await tx.execute(sql`
        update assistant_reservations set settled = true
         where tenant_id = ${TENANT} and id = ${id}`);
      return { overrun: Math.max(0, spent - reserved) };
    },

    // Resolves reservations left open longer than olderThanMs: one that never
    // reached the provider is given back, one that did is charged in full
    // because what it cost is unknown. At most MAX_LIMIT per call.
    async sweep(now: Date, olderThanMs: number): Promise<{ released: number; charged: number }> {
      const cutoff = new Date(now.getTime() - whole(olderThanMs, 'olderThanMs'));
      const open = await tx.execute<OpenReservation>(sql`
        select id, reserved::text as reserved, sent, levels
          from assistant_reservations
         where tenant_id = ${TENANT} and not settled
           and created_at < ${cutoff.toISOString()}::timestamptz
         order by created_at
         limit ${MAX_LIMIT}
           for update skip locked`);
      let released = 0;
      let charged = 0;
      const refunds: Refund[] = [];
      for (const reservation of open) {
        if (reservation.sent) {
          charged += 1;
        } else {
          for (const level of reservation.levels) {
            refunds.push({ level, tokens: Number(reservation.reserved) });
          }
          released += 1;
        }
      }
      await refundInLockOrder(refunds);
      if (open.length > 0) {
        await tx.execute(sql`
          update assistant_reservations set settled = true
           where tenant_id = ${TENANT}
             and id = any(array[${sql.join(
               open.map((reservation) => sql`${reservation.id}::uuid`),
               sql`, `,
             )}])`);
      }
      return { released, charged };
    },
  };
}
