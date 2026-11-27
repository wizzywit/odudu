import { capRefusal, type ApprovalPorts, type ChatCaller } from '@odudu/assistant';
import { withTenantRetrying } from '@odudu/db';
import { agentApprovalRepository, approvalDigest } from '@odudu/domain-agents';
import { auditRepository } from '@odudu/domain-audit';
import { ADMIN_API_AUDIENCE, ASSISTANT_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { TOOLS } from '@odudu/mcp';
import {
  AGENT_TOKEN_MAX_TTL_SECONDS,
  AgentTokenRefused,
  ApprovalLimitReached,
  AssistantGrantRefused,
  consumeApproval,
  decideApproval,
  grantAssistantWrite,
  MCP_WRITE_SCOPE,
  mintAgentToken,
  requestApproval,
  tenantLookupRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { callAsAssistant, targetFactsOf, type AssistantChatParts } from '#/assistant-call';
import { grantWriteBudget } from '#/mcp-deps';

// The kind an approval for one of the assistant's changes carries, apart from
// the CIBA kind of a mailed consent.
export const ASSISTANT_WRITE_KIND = 'assistant_write';

/**
 * What an approval is a digest of: the tool, every argument as the call carries
 * it, the conversation, the person it is for and, in another tenant, that
 * tenant. The arguments are taken as the JSON they are, so a member the model
 * left undefined is one it never sent. An own-tenant digest has no target
 * member, so it is what it was before a conversation could act elsewhere.
 */
export function writeDigest(
  tenantId: string,
  ownerSubjectId: string,
  conversationId: string,
  tool: string,
  input: unknown,
  targetTenantId?: string,
): string {
  return approvalDigest({
    name: tool,
    input: {
      conversation: conversationId,
      ...(targetTenantId === undefined ? {} : { target_tenant: targetTenantId }),
      arguments: JSON.parse(JSON.stringify(input ?? null)) as unknown,
    },
    tenantId,
    ownerSubjectId,
    instanceId: null,
  });
}

// The tenant a conversation acts in when it is not the caller's own.
function targetOf(caller: ChatCaller): string | undefined {
  return caller.target !== undefined && caller.target.id !== caller.tenantId
    ? caller.target.id
    : undefined;
}

// The approval did not cover this call, or the write could not be made ready:
// nothing was spent that a later try cannot spend again.
class NotSpent extends Error {
  readonly refusal: string;

  constructor(refusal: string) {
    super(refusal);
    this.name = 'NotSpent';
    this.refusal = refusal;
  }
}

/**
 * The assistant's use of P5's approvals, wired to this process. An approval is
 * opened and decided only for the person it belongs to, and spent only for the
 * call its digest names; the write it allows is made under a grant of its own.
 */
export function approvalPortsFor(parts: AssistantChatParts): ApprovalPorts {
  const lookup = tenantLookupRepository(parts.ownerDatabase.db);
  const now = parts.now ?? (() => new Date());
  const tenantOf = async (caller: ChatCaller) => {
    const tenant = await lookup.byName(caller.tenantName);
    if (tenant?.id !== caller.tenantId) throw new Error('the tenant is not available');
    return tenant;
  };
  const lifespansOf = (tenant: Awaited<ReturnType<typeof tenantOf>>) => ({
    ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
    ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
    rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
    rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
  });

  // An approval authorises a change in another tenant, so that tenant's trail
  // holds it: who approved which tool, never the conversation. It is written as
  // the change is spent, before it runs, and a row that cannot be written stops
  // the change, so no change is made there without its record.
  const recordApprovalInTarget = (
    targetTenantId: string,
    caller: ChatCaller,
    homeTenantId: string,
    approvalId: string,
    tool: string,
  ): Promise<void> =>
    withTenantRetrying(parts.database.db, targetTenantId, (tx) =>
      auditRepository(tx).record({
        eventType: 'admin_mutation',
        action: 'assistant.approval',
        outcome: 'allowed',
        actorTenantId: homeTenantId,
        actorSubjectId: caller.ownerSubjectId,
        resourceType: 'agent_approval',
        resourceId: approvalId,
        detail: {
          tenant: homeTenantId,
          target_tenant: targetTenantId,
          subject: caller.ownerSubjectId,
          approval: approvalId,
          tool,
          state: 'approved',
          via: 'console',
        },
      }),
    );

  // What came of an approved change in another tenant, in the administrator's
  // own trail: the tool, the tenant and whether it was made. The target's trail
  // holds the tool call itself.
  const recordOutcomeAtHome = async (
    caller: ChatCaller,
    homeTenantId: string,
    conversationId: string,
    approvalId: string,
    tool: string,
    targetTenantId: string,
    outcome: 'executed' | 'failed',
  ): Promise<void> => {
    try {
      await withTenantRetrying(parts.database.db, homeTenantId, (tx) =>
        auditRepository(tx).record({
          eventType: 'admin_mutation',
          action: 'assistant.approval',
          outcome: outcome === 'executed' ? 'allowed' : 'failed',
          actorTenantId: homeTenantId,
          actorSubjectId: caller.ownerSubjectId,
          resourceType: 'assistant_conversation',
          resourceId: conversationId,
          detail: {
            tenant: homeTenantId,
            target_tenant: targetTenantId,
            subject: caller.ownerSubjectId,
            conversation: conversationId,
            approval: approvalId,
            tool,
            state: outcome,
            via: 'console',
          },
        }),
      );
    } catch (error) {
      parts.logger.error(
        { error: error instanceof Error ? error.name : 'unknown', tenantId: homeTenantId },
        'the outcome of a change in another tenant was not recorded in the administrator trail',
      );
    }
  };

  return {
    async open(caller, input, store) {
      const tenant = await tenantOf(caller);
      return withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
        const client = await clientRepository(tx).byClientId(ASSISTANT_CLIENT_ID);
        if (client?.builtinAssistant !== true) throw new Error('the assistant client is missing');
        // The same lock `requestApproval` takes, so two proposals at the caps cannot both pass.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`agent-approvals:${caller.ownerSubjectId}`}))`,
        );
        const held = await tx.execute<{ in_conversation: number; for_owner: number }>(sql`
          select count(*) filter (where c.conversation_id = ${input.conversationId})::int as in_conversation,
                 count(*)::int as for_owner
            from agent_approvals a
            left join assistant_approvals c on c.approval_id = a.id
           where a.tenant_id = ${tenant.id} and a.subject_id = ${caller.ownerSubjectId}
             and a.kind = ${ASSISTANT_WRITE_KIND} and a.state = 'pending'
             and a.expires_at > ${input.now.toISOString()}::timestamptz`);
        const refusal = capRefusal({
          inConversation: held[0]?.in_conversation ?? 0,
          forOwner: held[0]?.for_owner ?? 0,
        });
        if (refusal !== null) return { kind: 'refused' as const, reason: refusal };
        try {
          const approval = await requestApproval(
            tx,
            { tenantId: tenant.id },
            {
              subjectId: caller.ownerSubjectId,
              requestingClientId: client.id,
              instanceId: null,
              kind: ASSISTANT_WRITE_KIND,
              summary: input.summary,
              actionDigest: writeDigest(
                tenant.id,
                caller.ownerSubjectId,
                input.conversationId,
                input.tool,
                input.input,
                targetOf(caller),
              ),
              now: input.now,
            },
          );
          const value = await store(tx, {
            approvalId: approval.id,
            expiresAt: approval.expiresAt,
          });
          return { kind: 'opened' as const, value };
        } catch (error) {
          if (error instanceof ApprovalLimitReached) {
            return { kind: 'refused' as const, reason: 'limit' as const };
          }
          throw error;
        }
      });
    },

    async answer(caller, input, load) {
      const tenant = await tenantOf(caller);
      return withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
        // Only a person's own console sign-in decides: a token of another kind,
        // one that acts for an agent included, is refused before anything is read.
        const grant =
          caller.grantId === undefined ? null : await tokenGrantRepository(tx).byId(caller.grantId);
        const client = grant === null ? null : await clientRepository(tx).byId(grant.clientId);
        if (
          grant?.revokedAt !== null ||
          grant.sessionId === null ||
          grant.subjectId !== caller.ownerSubjectId ||
          client?.builtinAdmin !== true
        ) {
          return { kind: 'not_found' as const };
        }
        const target = await load(tx);
        if (target === undefined) return { kind: 'not_found' as const };
        const outcome = await decideApproval(
          tx,
          { tenantId: tenant.id },
          {
            approvalId: input.approvalId,
            subjectId: caller.ownerSubjectId,
            approve: input.approve,
            via: 'console',
            now: input.now,
          },
        );
        if (outcome === 'not_owner') return { kind: 'not_found' as const };
        if (outcome === 'not_pending') return { kind: 'not_pending' as const };
        const state = input.approve ? ('approved' as const) : ('denied' as const);
        await auditRepository(tx).record({
          eventType: 'admin_mutation',
          action: 'assistant.approval',
          outcome: 'allowed',
          actorTenantId: tenant.id,
          actorSubjectId: caller.ownerSubjectId,
          resourceType: 'assistant_conversation',
          resourceId: target.conversationId,
          detail: {
            tenant: tenant.id,
            ...(targetOf(caller) === undefined ? {} : { target_tenant: targetOf(caller) }),
            subject: caller.ownerSubjectId,
            conversation: target.conversationId,
            approval: input.approvalId,
            tool: target.tool,
            state,
            via: 'console',
            ...(input.withdrawn === undefined ? {} : { withdrawn: input.withdrawn }),
          },
        });
        return { kind: 'decided' as const, state };
      });
    },

    async retire(caller, input, find) {
      const tenant = await tenantOf(caller);
      await withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
        const found = await find(tx);
        if (found === undefined) return;
        const digest = writeDigest(
          tenant.id,
          caller.ownerSubjectId,
          input.conversationId,
          input.tool,
          input.input,
          targetOf(caller),
        );
        if (!(await consumeApproval(tx, found, digest, input.now))) return;
        await auditRepository(tx).record({
          eventType: 'admin_mutation',
          action: 'assistant.approval',
          outcome: 'refused',
          actorTenantId: tenant.id,
          actorSubjectId: caller.ownerSubjectId,
          resourceType: 'assistant_conversation',
          resourceId: input.conversationId,
          detail: {
            tenant: tenant.id,
            ...(targetOf(caller) === undefined ? {} : { target_tenant: targetOf(caller) }),
            subject: caller.ownerSubjectId,
            conversation: input.conversationId,
            approval: found,
            tool: input.tool,
            state: 'not_run',
            ...(input.reason === 'state_moved' ? { state_moved: true } : { human_only: true }),
            via: 'console',
          },
        });
      });
    },

    async write(caller, input, find) {
      const tenant = await tenantOf(caller);
      const at = input.now;
      const consoleGrantId = caller.grantId;
      const tool = TOOLS.find((entry) => entry.name === input.tool);
      if (tool?.access !== 'write' || consoleGrantId === undefined) {
        return { kind: 'not_approved' };
      }
      const targetFacts = await targetFactsOf(parts, lookup, caller);
      const mintDeps = {
        tenantId: tenant.id,
        issuer: caller.issuer,
        kek: parts.kek,
        claimMappers: parts.claimMappers,
        lifespans: lifespansOf(tenant),
      };
      // The approval is spent and its grant made together, so a call that
      // cannot be made ready has spent nothing.
      let approvalId: string;
      try {
        approvalId = await withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
          const found = await find(tx);
          if (found === undefined) throw new NotSpent('no_card');
          const digest = writeDigest(
            tenant.id,
            caller.ownerSubjectId,
            input.conversationId,
            input.tool,
            input.input,
            targetOf(caller),
          );
          if (!(await consumeApproval(tx, found, digest, at))) {
            const held = await agentApprovalRepository(tx).byId(found);
            throw new NotSpent(held?.state === 'consumed' ? 'spent' : 'not_spendable');
          }
          try {
            await grantAssistantWrite(
              tx,
              { tenantId: tenant.id, lifespans: mintDeps.lifespans },
              {
                approvalId: found,
                consoleGrantId,
                expectedSubjectId: caller.ownerSubjectId,
                now: at,
                ...(targetFacts === undefined ? {} : { target: targetFacts }),
              },
            );
          } catch (error) {
            if (error instanceof AssistantGrantRefused) throw new NotSpent(error.reason);
            throw error;
          }
          return found;
        });
      } catch (error) {
        if (error instanceof NotSpent) {
          parts.logger.warn(
            { refusal: error.refusal, tenantId: tenant.id },
            'an assistant change was not run',
          );
          return error.refusal === 'spent' ? { kind: 'spent' } : { kind: 'not_approved' };
        }
        throw error;
      }

      // From here the approval is spent. The grant ends with the call, however it ends.
      try {
        const identity = await withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
          const client = await clientRepository(tx).byClientId(ASSISTANT_CLIENT_ID);
          if (client?.builtinAssistant !== true) throw new Error('the assistant client is missing');
          return { clientId: client.clientId, clientDbId: client.id };
        });
        const landsIn = targetOf(caller);
        if (landsIn !== undefined) {
          try {
            await recordApprovalInTarget(landsIn, caller, tenant.id, approvalId, input.tool);
          } catch (error) {
            parts.logger.error(
              { error: error instanceof Error ? error.name : 'unknown', tenantId: landsIn },
              'a change in another tenant was not run: its approval could not be recorded there',
            );
            return { kind: 'not_approved' };
          }
        }
        const minted = await withTenantRetrying(parts.database.db, tenant.id, (tx) =>
          mintAgentToken(tx, mintDeps, {
            subjectGrantId: approvalId,
            expectedSubjectId: caller.ownerSubjectId,
            agentClientId: identity.clientId,
            audience: ADMIN_API_AUDIENCE,
            scope: [MCP_WRITE_SCOPE],
            notAfter: new Date(at.getTime() + AGENT_TOKEN_MAX_TTL_SECONDS * 1000),
            now: at,
          }),
        );
        const result = await callAsAssistant(
          parts,
          caller,
          {
            grantId: approvalId,
            conversationId: input.conversationId,
            turnId: input.turnId,
            scope: [MCP_WRITE_SCOPE],
            budget: grantWriteBudget(
              parts.database,
              { tenant: { id: tenant.id, name: caller.tenantName }, grantId: approvalId },
              undefined,
              parts.logger,
              now,
              targetOf(caller),
              input.tier === 'C',
            ),
            holdsWrite: true,
          },
          identity,
          minted.accessToken,
          tool,
          input.input,
        );
        if (landsIn !== undefined) {
          await recordOutcomeAtHome(
            caller,
            tenant.id,
            input.conversationId,
            approvalId,
            input.tool,
            landsIn,
            result.isError ? 'failed' : 'executed',
          );
        }
        return { kind: 'done', result };
      } catch (error) {
        if (error instanceof AgentTokenRefused) {
          parts.logger.warn(
            { reason: error.reason, tenantId: tenant.id },
            'the assistant could not get a token for an approved change',
          );
          return { kind: 'not_approved' };
        }
        throw error;
      } finally {
        // A failed revoke is logged and never replaces what the write came to: the
        // grant is revoked by the upkeep if it is left.
        try {
          await withTenantRetrying(parts.database.db, tenant.id, (tx) =>
            tokenGrantRepository(tx).revoke(approvalId, now()),
          );
        } catch (error) {
          parts.logger.error(
            { error: error instanceof Error ? error.name : 'unknown', tenantId: tenant.id },
            'the grant of an approved assistant change was not revoked',
          );
        }
      }
    },
  };
}
