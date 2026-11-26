import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { ASSISTANT_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';

export interface AssistantRefusal {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly conversationId: string;
  // A fixed code (`AssistantGrantRefusal` or `AgentTokenRefusal`), never free text.
  readonly refusal: string;
}

/**
 * Says in the audit trail that the console assistant was refused an identity
 * for a conversation, or a token for one of its calls: who, which client and
 * the refusal's code. Nothing of the request or of any token goes in the row.
 */
export async function recordAssistantRefusal(
  tx: TenantScopedDatabase,
  input: AssistantRefusal,
): Promise<void> {
  const assistant = await clientRepository(tx).byClientId(ASSISTANT_CLIENT_ID);
  await auditRepository(tx).record({
    eventType: 'agent_identity',
    action: 'assistant.access_refused',
    outcome: 'refused',
    actorTenantId: input.tenantId,
    actorSubjectId: input.subjectId,
    actorClientId: assistant?.id ?? null,
    resourceType: 'assistant_conversation',
    resourceId: input.conversationId,
    detail: {
      reason: 'denied',
      agent_client: ASSISTANT_CLIENT_ID,
      owner: input.subjectId,
      refusal: input.refusal,
    },
  });
}
