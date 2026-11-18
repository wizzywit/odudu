import { requiredActionSchema, type RequiredAction } from '@odudu/contracts/admin';
import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { users } from '@odudu/domain-identity';
import { clientRepository, tenantSettingsRepository } from '@odudu/domain-tenant';
import { clientOidcConfigRepository } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { chooseReturnUri } from '#/service/return-target';
import { canSendMail, type AccountLinkPurpose, type SendAccountLink } from '#/usecase/account-link';
import {
  lockSubjectRow,
  refuseOverTargetCeiling,
  type TargetCeilingInput,
  type TargetCeilingRefusal,
} from '#/usecase/subjects';

export type AccountEmailKind = 'reset_password' | 'verify_email' | 'execute_actions';

export interface AccountEmailAuditEvent {
  readonly action:
    'subject.password_reset_send' | 'subject.verification_send' | 'subject.actions_email_send';
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

/** Which link an administrator asks for, as the route reads it from the request. */
export type AccountEmailPurpose =
  | { readonly kind: 'reset_password' | 'verify_email' }
  | {
      readonly kind: 'execute_actions';
      readonly actions: readonly RequiredAction[];
    };

/** The client a link returns to when it finishes, as the request names it. */
export interface AccountEmailReturn {
  readonly clientId: string;
  readonly redirectUri?: string | undefined;
}

export type AccountEmailInput = TargetCeilingInput & {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly returnTo?: AccountEmailReturn | undefined;
} & AccountEmailPurpose;

export type AccountEmailOutcome =
  | { kind: 'not_found' }
  | TargetCeilingRefusal
  | { kind: 'unknown_client' }
  | { kind: 'return_uri_unregistered' }
  | { kind: 'return_uri_required' }
  | { kind: 'no_email' }
  | { kind: 'reset_password_off' }
  | { kind: 'no_mail_relay' }
  | { kind: 'unavailable' }
  | { kind: 'queued' };

const ACTIONS = {
  reset_password: 'subject.password_reset_send',
  verify_email: 'subject.verification_send',
  execute_actions: 'subject.actions_email_send',
} as const;

const ACTION_ORDER: readonly RequiredAction[] = requiredActionSchema.options;

function purposeOf(input: AccountEmailInput): {
  purpose: AccountLinkPurpose;
  detail: Record<string, unknown>;
} {
  if (input.kind !== 'execute_actions') return { purpose: input, detail: {} };
  const actions = ACTION_ORDER.filter((action) => input.actions.includes(action));
  return { purpose: { kind: input.kind, actions }, detail: { actions } };
}

type ResolvedReturn =
  | { kind: 'none' }
  | {
      kind: 'refused';
      refusal: 'unknown_client' | 'return_uri_unregistered' | 'return_uri_required';
    }
  | { kind: 'resolved'; clientId: string; uri: string };

// The client is looked up through the tenant's own rows, so another tenant's is
// as unknown as one that does not exist, and a disabled one is refused.
async function resolveReturn(
  tx: TenantScopedDatabase,
  returnTo: AccountEmailReturn | undefined,
): Promise<ResolvedReturn> {
  if (returnTo === undefined) return { kind: 'none' };
  const client = await clientRepository(tx).byClientId(returnTo.clientId);
  if (client?.enabled !== true) return { kind: 'refused', refusal: 'unknown_client' };
  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  const choice = chooseReturnUri(config?.redirectUris ?? [], returnTo.redirectUri);
  if (choice.kind === 'ok') return { kind: 'resolved', clientId: client.id, uri: choice.uri };
  return {
    kind: 'refused',
    refusal: choice.kind === 'required' ? 'return_uri_required' : 'return_uri_unregistered',
  };
}

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
    .select({ email: users.email, locale: users.locale })
    .from(users)
    .where(eq(users.subjectId, input.subjectId));
  if (user.length === 0) return { kind: 'not_found' };
  const action = ACTIONS[input.kind];
  const refused = await refuseOverTargetCeiling(tx, deps.audit, action, input);
  if (refused !== null) return refused;
  const returning = await resolveReturn(tx, input.returnTo);
  if (returning.kind === 'refused') return { kind: returning.refusal };
  const { purpose, detail } = purposeOf(input);

  const email = user[0]?.email ?? null;
  if (email === null) return { kind: 'no_email' };
  const setsPassword =
    purpose.kind === 'reset_password' ||
    (purpose.kind === 'execute_actions' && purpose.actions.includes('update-password'));
  if (setsPassword) {
    const settings = await tenantSettingsRepository(tx).byId(input.tenantId);
    if (settings?.reset_password_allowed !== true) return { kind: 'reset_password_off' };
  }
  if (!(await canSendMail(tx, input.tenantId, deps.deploymentSmtp))) {
    return { kind: 'no_mail_relay' };
  }

  const tenant = await tx
    .select({ displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const sent = await deps.sendLink(tx, {
    ...purpose,
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    tenantDisplayName: tenant[0]?.displayName ?? input.tenantName,
    subjectId: input.subjectId,
    email,
    locale: user[0]?.locale ?? null,
    ...(returning.kind === 'resolved'
      ? { returnTo: { clientId: returning.clientId, uri: returning.uri } }
      : {}),
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
    detail:
      input.returnTo === undefined ? detail : { ...detail, client_id: input.returnTo.clientId },
  });
  return { kind: 'queued' };
}
