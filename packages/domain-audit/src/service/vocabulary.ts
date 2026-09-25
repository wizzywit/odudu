// The fixed vocabulary of audit actions this server writes, grouped by the
// event type they belong under. `admin_mutation` is not here: P4c's
// action strings are free-form (one per resource mutation) and its own
// `detail` allowlist lives in @odudu/protocol-admin's audit-detail.ts.
export const AUDIT_ACTIONS = {
  admin_access: ['capability.refused', 'token.foreign_issuer'],
  authentication: [
    'login.password',
    'login.otp',
    'login.recovery_code',
    'login.passkey',
    'factor.offered',
    'lockout.tripped',
    'client.authenticate',
  ],
  session: ['session.created', 'session.ended'],
  token: [
    'token.issue',
    'token.refresh',
    'token.exchange',
    'token.revoke',
    'grant.revoked_on_reuse',
    'grant.revoked_on_code_replay',
  ],
  credential: [
    'account.registered',
    'email.verified',
    'password.reset',
    'password.changed',
    'otp.enrolled',
    'passkey.enrolled',
    'recovery_codes.issued',
  ],
} as const;

export type AuditEventType = 'admin_mutation' | keyof typeof AUDIT_ACTIONS;

export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  'admin_mutation',
  'admin_access',
  'authentication',
  'session',
  'token',
  'credential',
];

export type AuditReason =
  | 'unknown_subject'
  | 'bad_credential'
  | 'locked_out'
  | 'replayed'
  | 'already_used'
  | 'subject_mismatch'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'invalid_target'
  | 'unauthorized_client'
  | 'rate_limited'
  | 'foreign_issuer'
  | 'missing_capability';

export type AuditOutcome = 'allowed' | 'refused' | 'failed';

interface EventCommon {
  readonly outcome: AuditOutcome;
  readonly actorTenantId?: string | null;
  readonly actorSubjectId?: string | null;
  readonly actorClientId?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
}

type WithReason<Detail extends Record<string, unknown>> = Readonly<
  Detail & { reason?: AuditReason }
>;

export interface AdminMutationInput extends EventCommon {
  readonly eventType: 'admin_mutation';
  readonly action: string;
  readonly detail?: Record<string, unknown> | undefined;
}

type AdminAccessInput =
  | (EventCommon & {
      readonly eventType: 'admin_access';
      readonly action: 'capability.refused';
      readonly detail?: WithReason<{ capability: string }>;
    })
  | (EventCommon & {
      readonly eventType: 'admin_access';
      readonly action: 'token.foreign_issuer';
      readonly detail?: WithReason<Record<string, never>>;
    });

type AuthenticationInput =
  | (EventCommon & {
      readonly eventType: 'authentication';
      readonly action:
        'login.password' | 'login.otp' | 'login.recovery_code' | 'login.passkey' | 'factor.offered';
      readonly detail?: WithReason<{ factor: string }>;
    })
  | (EventCommon & {
      readonly eventType: 'authentication';
      readonly action: 'lockout.tripped';
      readonly detail?: WithReason<Record<string, never>>;
    })
  | (EventCommon & {
      readonly eventType: 'authentication';
      readonly action: 'client.authenticate';
      readonly detail?: WithReason<{ method: string }>;
    });

type SessionInput =
  | (EventCommon & {
      readonly eventType: 'session';
      readonly action: 'session.created';
      readonly detail?: WithReason<Record<string, never>>;
    })
  | (EventCommon & {
      readonly eventType: 'session';
      readonly action: 'session.ended';
      readonly detail?: WithReason<{ via: 'logout' | 'admin' | 'evicted' }>;
    });

type TokenInput =
  | (EventCommon & {
      readonly eventType: 'token';
      readonly action: 'token.issue';
      readonly detail?: WithReason<{ grant_type: string; scope: string }>;
    })
  | (EventCommon & {
      readonly eventType: 'token';
      readonly action: 'token.refresh';
      readonly detail?: WithReason<{ scope: string }>;
    })
  | (EventCommon & {
      readonly eventType: 'token';
      readonly action: 'token.exchange';
      readonly detail?: WithReason<{
        mode: 'delegation' | 'impersonation';
        scope: string;
        requested_token_type: string;
      }>;
    })
  | (EventCommon & {
      readonly eventType: 'token';
      readonly action: 'token.revoke' | 'grant.revoked_on_reuse' | 'grant.revoked_on_code_replay';
      readonly detail?: WithReason<Record<string, never>>;
    });

type CredentialInput = EventCommon & {
  readonly eventType: 'credential';
  readonly action:
    | 'account.registered'
    | 'email.verified'
    | 'password.reset'
    | 'password.changed'
    | 'otp.enrolled'
    | 'passkey.enrolled'
    | 'recovery_codes.issued';
  readonly detail?: WithReason<Record<string, never>>;
};

export type VocabularyEventInput =
  AdminAccessInput | AuthenticationInput | SessionInput | TokenInput | CredentialInput;

export type AuditEventInput = AdminMutationInput | VocabularyEventInput;

// Extra `detail` keys a vocabulary action allows, beyond `reason`. An
// action absent here allows no extra keys at all. `admin_mutation`'s
// actions are free-form and never appear in this table, so an action
// this repository does not recognise falls through `assertDetailAllowed`
// untouched — its own allowlist lives in audit-detail.ts.
const ACTION_DETAIL_KEYS: Readonly<Record<string, readonly string[]>> = {
  'capability.refused': ['capability'],
  'login.password': ['factor'],
  'login.otp': ['factor'],
  'login.recovery_code': ['factor'],
  'login.passkey': ['factor'],
  'factor.offered': ['factor'],
  'client.authenticate': ['method'],
  'session.ended': ['via'],
  'token.issue': ['grant_type', 'scope'],
  'token.refresh': ['scope'],
  'token.exchange': ['mode', 'scope', 'requested_token_type'],
};

const KNOWN_VOCABULARY_ACTIONS = new Set<string>(Object.values(AUDIT_ACTIONS).flat());

const AUDIT_REASONS: readonly AuditReason[] = [
  'unknown_subject',
  'bad_credential',
  'locked_out',
  'replayed',
  'already_used',
  'subject_mismatch',
  'invalid_grant',
  'invalid_scope',
  'invalid_target',
  'unauthorized_client',
  'rate_limited',
  'foreign_issuer',
  'missing_capability',
];

function isAuditReason(value: unknown): value is AuditReason {
  return typeof value === 'string' && (AUDIT_REASONS as readonly string[]).includes(value);
}

/**
 * Rejects a `detail` key the vocabulary table does not name for this
 * action, and an invalid `reason` value. A runtime check behind the
 * type-level union above, so a cast cannot smuggle a key through. A
 * no-op for `admin_mutation` and any other action outside the fixed
 * vocabulary — that allowlist is `audit-detail.ts`'s to own.
 */
export function assertDetailAllowed(action: string, detail: Record<string, unknown>): void {
  if (!KNOWN_VOCABULARY_ACTIONS.has(action)) return;

  const allowedKeys = new Set<string>([...(ACTION_DETAIL_KEYS[action] ?? []), 'reason']);
  for (const key of Object.keys(detail)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`audit event '${action}' does not allow detail key '${key}'`);
    }
  }

  const reason = detail.reason;
  if (reason !== undefined && !isAuditReason(reason)) {
    const shown = typeof reason === 'string' ? reason : JSON.stringify(reason);
    throw new Error(`audit event '${action}' has an invalid reason '${shown}'`);
  }
}
