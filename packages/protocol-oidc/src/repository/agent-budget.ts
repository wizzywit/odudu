import { type TenantScopedDatabase } from '@odudu/db';
import { agentBudgetWindows, agentInstances } from '@odudu/domain-agents';
import { and, eq, sql } from 'drizzle-orm';
import { budgetGrantId } from '#/repository/grants';
import { tokenGrants } from '#/schema/token-grants';

export type BudgetKind = 'mutating' | 'create';
export type BudgetLevel = 'grant' | 'instance' | 'window';

interface Caps {
  mutating: number;
  creates: number;
}

export interface SpendInput {
  // A write that changes who can sign in, what a token carries or what goes
  // live is counted apart from the rest, on the grant and on the daily window,
  // so a burst of ordinary writes cannot spend what it needs. It has the same
  // limits and is not counted as a create.
  privileged?: boolean;
  grantId: string;
  instanceId: string | null;
  ownerSubjectId: string;
  agentClientId: string;
  kind: BudgetKind;
  now: Date;
  limits: {
    grant: Caps;
    // Narrows the slice the instance was minted with; never widens it.
    instanceSlice: Caps | null;
    windowWrites: number;
  };
}

export type SpendOutcome = { kind: 'ok' } | { kind: 'refused'; level: BudgetLevel };

export type ReleaseInput = Omit<SpendInput, 'limits'>;

const DAY_MS = 86_400_000;

// The 24-hour UTC bucket `now` falls in.
function windowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}

function refused(level: BudgetLevel): SpendOutcome {
  return { kind: 'refused', level };
}

function over(spent: Caps, caps: Caps, create: boolean): boolean {
  return spent.mutating >= caps.mutating || (create && spent.creates >= caps.creates);
}

// Whether the grant a call carries has not been revoked. A plain read, taken
// after the root's lock: a revoke that commits at the same moment as a spend
// cannot be told from a write that finished just before it, so the call is
// refused only if the revoke had committed when this ran.
async function notRevoked(tx: TenantScopedDatabase, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ revokedAt: tokenGrants.revokedAt })
    .from(tokenGrants)
    .where(eq(tokenGrants.id, id));
  return row?.revokedAt === null;
}

// A revoked, lapsed or idle instance spends nothing; the same test as
// `isLive` in usecase/acting-instance.ts, which a repository may not import.
function running(
  instance: { revokedAt: Date | null; expiresAt: Date; idleExpiresAt: Date | null },
  now: Date,
): boolean {
  return (
    instance.revokedAt === null &&
    instance.expiresAt.getTime() > now.getTime() &&
    (instance.idleExpiresAt === null || instance.idleExpiresAt.getTime() > now.getTime())
  );
}

export function agentBudgetRepository(tx: TenantScopedDatabase) {
  return {
    // Spends one write at every level a call counts at: the root grant it
    // belongs to, the agent instance making it and the daily window of its owner
    // and agent client. Only the root grant is locked (`for no key update`, which
    // a child insert's key share passes), then the instance and the window. Each
    // is checked before any is written, so a refusal leaves the others untouched.
    // A create also counts as a mutating call. A grant that is missing or revoked,
    // root or carried by the call, is refused at the grant.
    async spend(input: SpendInput): Promise<SpendOutcome> {
      const create = input.kind === 'create';
      const privileged = input.privileged === true;
      const root = await budgetGrantId(tx, input.grantId);
      if (root === null) return refused('grant');

      const [grant] = await tx
        .select({
          tenantId: tokenGrants.tenantId,
          writes: privileged ? tokenGrants.agentPrivilegedWrites : tokenGrants.agentWrites,
          creates: tokenGrants.agentCreates,
          revokedAt: tokenGrants.revokedAt,
        })
        .from(tokenGrants)
        .where(eq(tokenGrants.id, root))
        .for('no key update');
      if (input.grantId !== root && !(await notRevoked(tx, input.grantId))) {
        return refused('grant');
      }
      if (grant?.revokedAt !== null) return refused('grant');
      if (over({ mutating: grant.writes, creates: grant.creates }, input.limits.grant, create)) {
        return refused('grant');
      }

      if (input.instanceId !== null) {
        const [instance] = await tx
          .select({
            mutating: agentInstances.spentMutating,
            creates: agentInstances.spentCreates,
            sliceMutating: agentInstances.sliceMutating,
            sliceCreates: agentInstances.sliceCreates,
            revokedAt: agentInstances.revokedAt,
            expiresAt: agentInstances.expiresAt,
            idleExpiresAt: agentInstances.idleExpiresAt,
          })
          .from(agentInstances)
          .where(eq(agentInstances.id, input.instanceId))
          .for('update');
        const narrowed = input.limits.instanceSlice;
        if (instance === undefined || !running(instance, input.now)) return refused('instance');
        const caps = {
          mutating: Math.min(instance.sliceMutating, narrowed?.mutating ?? Infinity),
          creates: Math.min(instance.sliceCreates, narrowed?.creates ?? Infinity),
        };
        if (over(instance, caps, create)) return refused('instance');
      }

      const start = windowStart(input.now);
      await tx
        .insert(agentBudgetWindows)
        .values({
          tenantId: grant.tenantId,
          ownerSubjectId: input.ownerSubjectId,
          agentClientId: input.agentClientId,
          windowStart: start,
        })
        .onConflictDoNothing();
      const [window] = await tx
        .select({
          writes: privileged ? agentBudgetWindows.privilegedWrites : agentBudgetWindows.writes,
        })
        .from(agentBudgetWindows)
        .where(
          and(
            eq(agentBudgetWindows.ownerSubjectId, input.ownerSubjectId),
            eq(agentBudgetWindows.agentClientId, input.agentClientId),
            eq(agentBudgetWindows.windowStart, start),
          ),
        )
        .for('update');
      if (window === undefined || window.writes >= input.limits.windowWrites) {
        return refused('window');
      }

      await tx
        .update(tokenGrants)
        .set({
          ...(privileged
            ? { agentPrivilegedWrites: sql`${tokenGrants.agentPrivilegedWrites} + 1` }
            : { agentWrites: sql`${tokenGrants.agentWrites} + 1` }),
          agentCreates: sql`${tokenGrants.agentCreates} + ${create ? 1 : 0}`,
        })
        .where(eq(tokenGrants.id, root));
      if (input.instanceId !== null) {
        await tx
          .update(agentInstances)
          .set({
            spentMutating: sql`${agentInstances.spentMutating} + 1`,
            spentCreates: sql`${agentInstances.spentCreates} + ${create ? 1 : 0}`,
          })
          .where(eq(agentInstances.id, input.instanceId));
      }
      await tx
        .update(agentBudgetWindows)
        .set(
          privileged
            ? { privilegedWrites: sql`${agentBudgetWindows.privilegedWrites} + 1` }
            : { writes: sql`${agentBudgetWindows.writes} + 1` },
        )
        .where(
          and(
            eq(agentBudgetWindows.ownerSubjectId, input.ownerSubjectId),
            eq(agentBudgetWindows.agentClientId, input.agentClientId),
            eq(agentBudgetWindows.windowStart, start),
          ),
        );
      return { kind: 'ok' };
    },

    // Gives back a call known to have changed nothing, at every level, never
    // below none, taking the rows in the order `spend` does. The window is the
    // one `now` falls in, so a caller passes the instant the call was spent at,
    // which the MCP door keeps for the purpose, not the instant it is given back.
    async release(input: ReleaseInput): Promise<void> {
      const create = input.kind === 'create';
      const privileged = input.privileged === true;
      const root = await budgetGrantId(tx, input.grantId);
      if (root === null) return;
      await tx
        .update(tokenGrants)
        .set({
          ...(privileged
            ? {
                agentPrivilegedWrites: sql`greatest(${tokenGrants.agentPrivilegedWrites} - 1, 0)`,
              }
            : { agentWrites: sql`greatest(${tokenGrants.agentWrites} - 1, 0)` }),
          agentCreates: sql`greatest(${tokenGrants.agentCreates} - ${create ? 1 : 0}, 0)`,
        })
        .where(eq(tokenGrants.id, root));
      if (input.instanceId !== null) {
        await tx
          .update(agentInstances)
          .set({
            spentMutating: sql`greatest(${agentInstances.spentMutating} - 1, 0)`,
            spentCreates: sql`greatest(${agentInstances.spentCreates} - ${create ? 1 : 0}, 0)`,
          })
          .where(eq(agentInstances.id, input.instanceId));
      }
      await tx
        .update(agentBudgetWindows)
        .set(
          privileged
            ? { privilegedWrites: sql`greatest(${agentBudgetWindows.privilegedWrites} - 1, 0)` }
            : { writes: sql`greatest(${agentBudgetWindows.writes} - 1, 0)` },
        )
        .where(
          and(
            eq(agentBudgetWindows.ownerSubjectId, input.ownerSubjectId),
            eq(agentBudgetWindows.agentClientId, input.agentClientId),
            eq(agentBudgetWindows.windowStart, windowStart(input.now)),
          ),
        );
    },
  };
}
