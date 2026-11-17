import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type AuditAction } from '@odudu/domain-audit';
import { clientRepository } from '@odudu/domain-tenant';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { type ActionStatus } from '#/schema/authentication-sessions';
import { type RequiredAction } from '#/schema/required-action';

// 'requested' is the page being shown; the rest are how it ended.
export type ActionStep = 'requested' | ActionStatus;

export interface RecordActionStep {
  authSessionId: string;
  subjectId: string;
  action: RequiredAction;
  step: ActionStep;
}

type StepAction = Extract<AuditAction<'credential'>, `action.${string}`>;

const AUDITED: Readonly<Record<ActionStep, { action: StepAction; outcome: 'allowed' | 'failed' }>> =
  {
    requested: { action: 'action.requested', outcome: 'allowed' },
    success: { action: 'action.completed', outcome: 'allowed' },
    cancelled: { action: 'action.cancelled', outcome: 'allowed' },
    error: { action: 'action.failed', outcome: 'failed' },
  };

// What happened to a credential action an application requested, written to
// the parked request (which the response is built from) and to the audit
// trail naming the client. An ending is recorded once: the first one stands,
// and a second attempt to write one changes nothing and audits nothing.
export async function recordActionStep(
  tx: TenantScopedDatabase,
  input: RecordActionStep,
): Promise<void> {
  const sessions = authenticationSessionRepository(tx);
  const parked = await sessions.byId(input.authSessionId);
  if (parked === null) return;
  if (input.step !== 'requested' && !(await sessions.recordActionStatus(parked.id, input.step))) {
    return;
  }
  const client = await clientRepository(tx).byClientId(parked.pendingRequest.clientId);
  const { action, outcome } = AUDITED[input.step];
  await auditRepository(tx).record({
    eventType: 'credential',
    action,
    outcome,
    actorSubjectId: input.subjectId,
    actorClientId: client === null ? null : client.id,
    resourceType: 'subject',
    resourceId: input.subjectId,
    detail: { action: input.action },
  });
}
