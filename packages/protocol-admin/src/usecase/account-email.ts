import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { users } from '@odudu/domain-identity';
import { tenantSettingsRepository } from '@odudu/domain-tenant';
import { eq } from 'drizzle-orm';
import { tenantSmtpRepository } from '#/repository/tenant-smtp';
import {
  lockSubjectRow,
  refuseOverTargetCeiling,
  type TargetCeilingInput,
  type TargetCeilingRefusal,
} from '#/usecase/subjects';

export type AccountEmailKind = 'reset_password' | 'verify_email';

/** What a link is minted for and who it goes to; the minting is @odudu/account's. */
export interface AccountLinkRequest {
  readonly kind: AccountEmailKind;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantDisplayName: string;
  readonly subjectId: string;
  readonly email: string;
}

/**
 * Mints the link and queues the mail carrying it, in the caller's
 * transaction, through the same write a self-service request makes.
 * `unavailable` when the deployment has no public base URL to put in it.
 */
export type SendAccountLink = (
  tx: TenantScopedDatabase,
  request: AccountLinkRequest,
) => Promise<'queued' | 'unavailable'>;

export interface AccountEmailAuditEvent {
  readonly action: 'subject.password_reset_send' | 'subject.verification_send';
  readonly resourceType: 'subject';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused';
  readonly detail?: Record<string, unknown>;
}

export interface AccountEmailDeps {
  readonly audit: (tx: TenantScopedDatabase, event: AccountEmailAuditEvent) => Promise<void>;
  readonly sendLink: SendAccountLink;
  /** Whether the deployment has a sender of its own for a tenant without one. */
  readonly deploymentSmtp: boolean;
}

export interface AccountEmailInput extends TargetCeilingInput {
  readonly kind: AccountEmailKind;
  readonly tenantId: string;
  readonly tenantName: string;
}

export type AccountEmailOutcome =
  | { kind: 'not_found' }
  | TargetCeilingRefusal
  | { kind: 'no_email' }
  | { kind: 'reset_password_off' }
  | { kind: 'no_mail_relay' }
  | { kind: 'unavailable' }
  | { kind: 'queued' };

const ACTIONS = {
  reset_password: 'subject.password_reset_send',
  verify_email: 'subject.verification_send',
} as const;

// Each refusal is one the link would otherwise meet later, silently: an
// address that is not there, a tenant whose reset page refuses every link,
// or mail that is only ever written to the log (`GET …/smtp`'s `none`).
export async function sendAccountEmail(
  tx: TenantScopedDatabase,
  deps: AccountEmailDeps,
  input: AccountEmailInput,
): Promise<AccountEmailOutcome> {
  if (!(await lockSubjectRow(tx, input.subjectId))) return { kind: 'not_found' };
  const user = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.subjectId, input.subjectId));
  if (user.length === 0) return { kind: 'not_found' };
  const action = ACTIONS[input.kind];
  const refused = await refuseOverTargetCeiling(tx, deps.audit, action, input);
  if (refused !== null) return refused;

  const email = user[0]?.email ?? null;
  if (email === null) return { kind: 'no_email' };
  if (input.kind === 'reset_password') {
    const settings = await tenantSettingsRepository(tx).byId(input.tenantId);
    if (settings?.reset_password_allowed !== true) return { kind: 'reset_password_off' };
  }
  const relay = await tenantSmtpRepository(tx).byTenantId(input.tenantId);
  if (relay === null && !deps.deploymentSmtp) return { kind: 'no_mail_relay' };

  const tenant = await tx
    .select({ displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const sent = await deps.sendLink(tx, {
    kind: input.kind,
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    tenantDisplayName: tenant[0]?.displayName ?? input.tenantName,
    subjectId: input.subjectId,
    email,
  });
  if (sent === 'unavailable') return { kind: 'unavailable' };

  await deps.audit(tx, {
    action,
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });
  return { kind: 'queued' };
}
