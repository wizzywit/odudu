import type { ApprovalPorts, ChatCaller } from '@odudu/assistant';
import { withTenantRetrying } from '@odudu/db';
import { approvalDigest } from '@odudu/domain-agents';
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
import { callAsAssistant, type AssistantChatParts } from '#/assistant-call';
import { grantWriteBudget } from '#/mcp-deps';

// The kind an approval for one of the assistant's changes carries, apart from
// the CIBA kind of a mailed consent.
export const ASSISTANT_WRITE_KIND = 'assistant_write';

/**
 * What an approval is a digest of: the tool, every argument as the call carries
 * it, the conversation and the person it is for. The arguments are taken as
 * the JSON they are, so a member the model left undefined is one it never sent.
 */
export function writeDigest(
  tenantId: string,
  ownerSubjectId: string,
  conversationId: string,
  tool: string,
  input: unknown,
): string {
  return approvalDigest({
    name: tool,
    input: { conversation: conversationId, arguments: JSON.parse(JSON.stringify(input ?? null)) },
    tenantId,
    ownerSubjectId,
    instanceId: null,
  });
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

  return {
    async open(caller, input, store) {
      const tenant = await tenantOf(caller);
      return withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
        const client = await clientRepository(tx).byClientId(ASSISTANT_CLIENT_ID);
        if (client?.builtinAssistant !== true) throw new Error('the assistant client is missing');
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

    async decide(caller, input, load) {
      const tenant = await tenantOf(caller);
      return withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
        // Only a person's own console sign-in decides: a token of another kind,
        // one that acts for an agent included, is refused before anything is read.
        const grant =
          caller.grantId === undefined ? null : await tokenGrantRepository(tx).byId(caller.grantId);
        const client = grant === null ? null : await clientRepository(tx).byId(grant.clientId);
        if (
          grant === null ||
          grant.revokedAt !== null ||
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

    async write(caller, input, find) {
      const tenant = await tenantOf(caller);
      const at = input.now;
      const consoleGrantId = caller.grantId;
      const tool = TOOLS.find((entry) => entry.name === input.tool);
      if (tool?.access !== 'write' || consoleGrantId === undefined) {
        return { kind: 'not_approved' };
      }
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
          );
          if (!(await consumeApproval(tx, found, digest, at))) throw new NotSpent('not_spendable');
          try {
            await grantAssistantWrite(
              tx,
              { tenantId: tenant.id, lifespans: mintDeps.lifespans },
              {
                approvalId: found,
                consoleGrantId,
                expectedSubjectId: caller.ownerSubjectId,
                now: at,
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
          return { kind: 'not_approved' };
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
            scope: [MCP_WRITE_SCOPE],
            budget: grantWriteBudget(
              parts.database,
              { tenant: { id: tenant.id, name: caller.tenantName }, grantId: approvalId },
              undefined,
              parts.logger,
              now,
            ),
            holdsWrite: true,
          },
          identity,
          minted.accessToken,
          tool,
          input.input,
        );
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
        await withTenantRetrying(parts.database.db, tenant.id, (tx) =>
          tokenGrantRepository(tx).revoke(approvalId, now()),
        );
      }
    },
  };
}
