// The fixed vocabulary of audit actions this server writes, grouped by the
// event type they belong under. `admin_mutation` is not here: admin
// mutations' action strings are free-form, one per resource mutation, and
// their own `detail` allowlist lives in @odudu/protocol-admin's
// audit-detail.ts.
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

export type VocabularyEventType = keyof typeof AUDIT_ACTIONS;
export type AuditEventType = 'admin_mutation' | VocabularyEventType;
type VocabularyAction = (typeof AUDIT_ACTIONS)[VocabularyEventType][number];

export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  'admin_mutation',
  'admin_access',
  'authentication',
  'session',
  'token',
  'credential',
];

const AUDIT_REASONS = [
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
] as const;

export type AuditReason = (typeof AUDIT_REASONS)[number];

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

// `Record<string, never>` (an index signature mapping every key to
// `never`) is not the right way to say "no extra keys": intersected with
// `{ reason?: AuditReason }`, it collapses `reason` itself to `never`
// too. This says the same thing without doing that.
type ReasonOnly = Readonly<{ reason?: AuditReason }>;

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
      readonly detail?: ReasonOnly;
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
      readonly detail?: ReasonOnly;
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
      readonly detail?: ReasonOnly;
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
      readonly detail?: ReasonOnly;
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
  readonly detail?: ReasonOnly;
};

export type VocabularyEventInput =
  AdminAccessInput | AuthenticationInput | SessionInput | TokenInput | CredentialInput;

export type AuditEventInput = AdminMutationInput | VocabularyEventInput;

// Extra `detail` keys a vocabulary action allows, beyond `reason`. An
// action absent here allows no extra keys at all. `admin_mutation`'s
// actions are free-form and never appear in this table (nor in
// `VocabularyAction`, so a misspelled key here is a compile error), so an
// action this repository does not recognise falls through
// `assertDetailAllowed` untouched — its own allowlist lives in
// audit-detail.ts.
const ACTION_DETAIL_KEYS: Partial<Record<VocabularyAction, readonly string[]>> = {
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

const KNOWN_VOCABULARY_ACTIONS: ReadonlySet<string> = new Set(Object.values(AUDIT_ACTIONS).flat());

function isVocabularyAction(action: string): action is VocabularyAction {
  return KNOWN_VOCABULARY_ACTIONS.has(action);
}

export function isAuditReason(value: unknown): value is AuditReason {
  return typeof value === 'string' && (AUDIT_REASONS as readonly string[]).includes(value);
}

const STRING_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'factor',
  'scope',
  'method',
  'grant_type',
  'requested_token_type',
  'capability',
]);

function isValidDetailValue(key: string, value: unknown): boolean {
  if (key === 'mode') return value === 'delegation' || value === 'impersonation';
  if (key === 'via') return value === 'logout' || value === 'admin' || value === 'evicted';
  if (STRING_DETAIL_KEYS.has(key)) return typeof value === 'string';
  return true;
}

/** A cast cannot smuggle a key or a bad value past this: it runs behind the type-level union above. */
export function assertDetailAllowed(action: string, detail: Record<string, unknown>): void {
  if (!isVocabularyAction(action)) return;

  const allowedKeys = new Set<string>([...(ACTION_DETAIL_KEYS[action] ?? []), 'reason']);
  for (const key of Object.keys(detail)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`audit event '${action}' does not allow detail key '${key}'`);
    }
    if (key !== 'reason' && !isValidDetailValue(key, detail[key])) {
      throw new Error(`audit event '${action}' has an invalid value for detail key '${key}'`);
    }
  }

  const reason = detail.reason;
  if (reason !== undefined && !isAuditReason(reason)) {
    const shown = typeof reason === 'string' ? reason : JSON.stringify(reason);
    throw new Error(`audit event '${action}' has an invalid reason '${shown}'`);
  }
}

/**
 * Rejects an action absent from `eventType`'s own list in `AUDIT_ACTIONS`
 * — a misspelling, or a mismatched pair such as `session`/`token.issue` —
 * before `assertDetailAllowed` ever runs. `assertDetailAllowed` alone
 * cannot catch this: an action it doesn't recognise is exactly what it
 * treats as `admin_mutation` and lets through untouched.
 */
export function assertActionKnown(eventType: VocabularyEventType, action: string): void {
  const actions: readonly string[] = AUDIT_ACTIONS[eventType];
  if (!actions.includes(action)) {
    throw new Error(`event type '${eventType}' has no action '${action}'`);
  }
}
