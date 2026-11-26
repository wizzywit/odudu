import { type AdminMutationAction } from '#/service/admin-mutation-actions';
// The fixed vocabulary of audit actions this server writes, grouped by the
// event type they belong under. `admin_mutation` is not here: admin
// mutations' action strings are free-form, one per resource mutation, and
// their own `detail` allowlist lives in @odudu/protocol-admin's
// audit-detail.ts.
export const AUDIT_ACTIONS = {
  admin_access: ['capability.refused', 'token.foreign_issuer', 'agent.tool_call'],
  agent_identity: [
    'agent.instance_minted',
    'agent.instance_revoked',
    'agent.delegation_created',
    'agent.delegation_revoked',
    'agent.approval_requested',
    'agent.approval_decided',
    'assistant.access_refused',
    'ciba.requested',
    'ciba.poll_refused',
    'ciba.token_issued',
  ],
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
    'account.registration_duplicate',
    'account.address_proved',
    'account.reconciled',
    'email.verified',
    'email.verification_resent',
    'email.changed',
    'password.reset',
    'password.changed',
    'otp.enrolled',
    'passkey.enrolled',
    'recovery_codes.issued',
    'recovery_codes.refused',
    'action.requested',
    'action.completed',
    'action.cancelled',
    'action.failed',
    'terms.accepted',
  ],
} as const;

export type VocabularyEventType = keyof typeof AUDIT_ACTIONS;
export type AuditEventType = 'admin_mutation' | VocabularyEventType;
export type AuditAction<T extends VocabularyEventType> = (typeof AUDIT_ACTIONS)[T][number];
type VocabularyAction = AuditAction<VocabularyEventType>;

export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  'admin_mutation',
  'admin_access',
  'agent_identity',
  'authentication',
  'session',
  'token',
  'credential',
];

export const AUDIT_REASONS = [
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
  'unsupported_token_type',
  'rate_limited',
  'foreign_issuer',
  'missing_capability',
  'agent_without_mcp_scope',
  'insufficient_scope',
  'already_registered',
  'timeout_outcome_unknown',
  'write_budget',
  'approval_limit',
  'polled_early',
  'expired',
  'denied',
] as const;

export type AuditReason = (typeof AUDIT_REASONS)[number];

export const AUDIT_OUTCOMES = ['allowed', 'refused', 'failed'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

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
  readonly action: AdminMutationAction;
  readonly detail?: Record<string, unknown> | undefined;
}

type AdminAccessInput =
  | (EventCommon & {
      readonly eventType: 'admin_access';
      readonly action: 'capability.refused';
      readonly detail?: WithReason<{ capability?: string; also_admits?: string[] }>;
    })
  | (EventCommon & {
      readonly eventType: 'admin_access';
      readonly action: 'token.foreign_issuer';
      readonly detail?: ReasonOnly;
    })
  | (EventCommon & {
      readonly eventType: 'admin_access';
      readonly action: 'agent.tool_call';
      readonly detail: WithReason<{
        agent_client: string;
        owner: string;
        tool: string;
        route: string;
        conversation?: string;
        turn?: string;
      }>;
    });

type AgentIdentityInput =
  | (EventCommon & {
      readonly eventType: 'agent_identity';
      readonly action: 'assistant.access_refused';
      readonly detail: WithReason<{ agent_client: string; owner: string; refusal: string }>;
    })
  | (EventCommon & {
      readonly eventType: 'agent_identity';
      readonly action: 'agent.instance_minted';
      readonly detail: WithReason<{
        agent_client: string;
        owner: string;
        instance: string;
        depth: number;
      }>;
    })
  | (EventCommon & {
      readonly eventType: 'agent_identity';
      readonly action: 'agent.instance_revoked';
      readonly detail: WithReason<{
        agent_client: string;
        owner: string;
        instance: string;
        depth: number;
        count: number;
        via: 'cascade' | 'owner_ended' | 'admin';
      }>;
    })
  | (EventCommon & {
      readonly eventType: 'agent_identity';
      readonly action: 'agent.delegation_created' | 'agent.delegation_revoked';
      readonly detail: WithReason<{
        agent_client: string;
        owner: string;
        delegation: string;
      }>;
    })
  | (EventCommon & {
      readonly eventType: 'agent_identity';
      readonly action: 'agent.approval_requested';
      readonly detail: WithReason<{
        agent_client: string;
        owner: string;
        approval: string;
        instance?: string;
      }>;
    })
  | (EventCommon & {
      readonly eventType: 'agent_identity';
      readonly action: 'agent.approval_decided';
      readonly detail: WithReason<{
        owner: string;
        approval: string;
        state: 'approved' | 'denied';
        via: 'ciba_page' | 'console';
      }>;
    })
  | (EventCommon & {
      readonly eventType: 'agent_identity';
      readonly action: 'ciba.requested' | 'ciba.poll_refused';
      readonly detail: WithReason<{
        agent_client: string;
        owner?: string;
        approval?: string;
      }>;
    })
  | (EventCommon & {
      readonly eventType: 'agent_identity';
      readonly action: 'ciba.token_issued';
      readonly detail: WithReason<{
        agent_client: string;
        owner: string;
        approval: string;
      }>;
    });

type AuthenticationInput =
  | (EventCommon & {
      readonly eventType: 'authentication';
      readonly action: 'login.password' | 'login.otp' | 'login.recovery_code' | 'factor.offered';
      readonly detail?: WithReason<{ factor: string }>;
    })
  | (EventCommon & {
      readonly eventType: 'authentication';
      readonly action: 'login.passkey';
      readonly detail?: WithReason<{ factor: string; user_verified?: boolean }>;
    })
  | (EventCommon & {
      readonly eventType: 'authentication';
      readonly action: 'lockout.tripped';
      readonly detail?: ReasonOnly;
    })
  | (EventCommon & {
      readonly eventType: 'authentication';
      readonly action: 'client.authenticate';
      readonly detail?: WithReason<{ method?: string }>;
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
      readonly detail?: WithReason<{ via: 'logout' | 'admin' | 'self' | 'evicted' }>;
    });

type TokenInput =
  // A refused request was never issued anything, so it has no scope, grant
  // type or mode to report: only why it was refused.
  | (EventCommon & {
      readonly eventType: 'token';
      readonly action: 'token.issue' | 'token.refresh' | 'token.exchange';
      readonly outcome: 'refused';
      readonly detail: Readonly<{ reason: AuditReason }>;
    })
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

export type BreachedCheckOutcome =
  'passed' | 'breached' | 'error_open' | 'error_closed' | 'off' | 'dataset_empty';

const BREACHED_CHECK_OUTCOMES: readonly string[] = [
  'passed',
  'breached',
  'error_open',
  'error_closed',
  'off',
  'dataset_empty',
];

type CredentialInput =
  | (EventCommon & {
      readonly eventType: 'credential';
      readonly action:
        | 'account.registration_duplicate'
        | 'account.address_proved'
        | 'email.verified'
        | 'email.verification_resent'
        | 'email.changed'
        | 'recovery_codes.refused';
      readonly detail?: ReasonOnly;
    })
  // One account folded into another: the survivor, the account that went,
  // whether its rows were carried over and how many of each moved.
  | (EventCommon & {
      readonly eventType: 'credential';
      readonly action: 'account.reconciled';
      readonly detail: Readonly<{
        survivor: string;
        loser: string;
        carried_over: boolean;
        moved: Readonly<Record<'credentials' | 'consents', number>>;
      }>;
    })
  // `detail.breached_check` says what the breached-password check decided.
  | (EventCommon & {
      readonly eventType: 'credential';
      readonly action: 'account.registered';
      readonly detail?: WithReason<{ breached_check?: BreachedCheckOutcome }>;
    })
  // `detail.notice` says whether the owner was told of the reset by mail.
  | (EventCommon & {
      readonly eventType: 'credential';
      readonly action: 'password.reset';
      readonly detail?: WithReason<{
        breached_check?: BreachedCheckOutcome;
        notice?: 'sent' | 'skipped_none';
      }>;
    })
  // `detail.ended_other_sessions` says whether the change ended the person's other sessions.
  | (EventCommon & {
      readonly eventType: 'credential';
      readonly action: 'password.changed';
      readonly detail?: WithReason<{
        ended_other_sessions: boolean;
        breached_check?: BreachedCheckOutcome;
        // True for the first password of an account that held none, with
        // `notice` saying whether the owner was told by mail.
        first_password?: boolean;
        notice?: 'sent' | 'skipped_unverified' | 'skipped_none';
      }>;
    })
  // `detail.version` is the version of the tenant's terms that was accepted.
  | (EventCommon & {
      readonly eventType: 'credential';
      readonly action: 'terms.accepted';
      readonly detail: Readonly<{ version: string }>;
    })
  // `detail.notice` says whether the subject was told of the change by mail.
  | (EventCommon & {
      readonly eventType: 'credential';
      readonly action: 'otp.enrolled' | 'passkey.enrolled' | 'recovery_codes.issued';
      readonly detail?: WithReason<{ notice?: 'sent' | 'skipped_unverified' | 'skipped_none' }>;
    })
  // An application sent the person to change a credential; `detail.action` is
  // the required action it named and `actorClientId` the application.
  | (EventCommon & {
      readonly eventType: 'credential';
      readonly action:
        'action.requested' | 'action.completed' | 'action.cancelled' | 'action.failed';
      readonly detail: WithReason<{ action: string }>;
    });

export type VocabularyEventInput =
  | AdminAccessInput
  | AgentIdentityInput
  | AuthenticationInput
  | SessionInput
  | TokenInput
  | CredentialInput;

export type AuditEventInput = AdminMutationInput | VocabularyEventInput;

// Extra `detail` keys a vocabulary action allows, beyond `reason`. An
// action absent here allows no extra keys at all. `admin_mutation`'s
// actions are free-form and never appear in this table (nor in
// `VocabularyAction`, so a misspelled key here is a compile error).
// `validatedRow` never calls `assertDetailAllowed` for an `admin_mutation`
// event at all, even when its free-form action string collides with a
// vocabulary one — its own allowlist lives in audit-detail.ts.
const ACTION_DETAIL_KEYS: Partial<Record<VocabularyAction, readonly string[]>> = {
  'capability.refused': ['capability', 'also_admits'],
  'agent.tool_call': ['agent_client', 'owner', 'tool', 'route', 'conversation', 'turn'],
  'agent.instance_minted': ['agent_client', 'owner', 'instance', 'depth'],
  'agent.instance_revoked': ['agent_client', 'owner', 'instance', 'depth', 'count', 'via'],
  'agent.delegation_created': ['agent_client', 'owner', 'delegation'],
  'agent.delegation_revoked': ['agent_client', 'owner', 'delegation'],
  'agent.approval_requested': ['agent_client', 'owner', 'approval', 'instance'],
  'agent.approval_decided': ['owner', 'approval', 'state', 'via'],
  'assistant.access_refused': ['agent_client', 'owner', 'refusal'],
  'ciba.requested': ['agent_client', 'owner', 'approval'],
  'ciba.poll_refused': ['agent_client', 'owner', 'approval'],
  'ciba.token_issued': ['agent_client', 'owner', 'approval'],
  'login.password': ['factor'],
  'login.otp': ['factor'],
  'login.recovery_code': ['factor'],
  'login.passkey': ['factor', 'user_verified'],
  'factor.offered': ['factor'],
  'client.authenticate': ['method'],
  'session.ended': ['via'],
  'password.changed': ['ended_other_sessions', 'breached_check', 'first_password', 'notice'],
  'password.reset': ['breached_check', 'notice'],
  'account.registered': ['breached_check'],
  'token.issue': ['grant_type', 'scope'],
  'token.refresh': ['scope'],
  'token.exchange': ['mode', 'scope', 'requested_token_type'],
  'action.requested': ['action'],
  'action.completed': ['action'],
  'action.cancelled': ['action'],
  'action.failed': ['action'],
  'otp.enrolled': ['notice'],
  'passkey.enrolled': ['notice'],
  'recovery_codes.issued': ['notice'],
  'account.reconciled': ['survivor', 'loser', 'carried_over', 'moved'],
  'terms.accepted': ['version'],
};

const KNOWN_VOCABULARY_ACTIONS: ReadonlySet<string> = new Set(Object.values(AUDIT_ACTIONS).flat());

function isVocabularyAction(action: string): action is VocabularyAction {
  return KNOWN_VOCABULARY_ACTIONS.has(action);
}

export function isAuditReason(value: unknown): value is AuditReason {
  return typeof value === 'string' && (AUDIT_REASONS as readonly string[]).includes(value);
}

const STRING_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'action',
  'factor',
  'scope',
  'method',
  'grant_type',
  'requested_token_type',
  'capability',
  'agent_client',
  'owner',
  'tool',
  'route',
  'version',
  'instance',
  'approval',
  'delegation',
]);

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SESSION_ENDED_VIA = ['logout', 'admin', 'self', 'evicted'];
const AGENT_VIA = ['owner', 'owner_ended', 'admin', 'cascade', 'reaper'];
const APPROVAL_VIA = ['ciba_page', 'console'];
const AGENT_APPROVAL_STATES = ['approved', 'denied'];

const TOOL_NAME = /^[a-z0-9_.-]{1,64}$/u;
// A route is a table key, `METHOD /path/:param`, never a concrete address;
// the admin router's own check that it is one lives with its table.
const ROUTE_KEY = /^[A-Z]{3,7} \/[A-Za-z0-9/:_.-]{0,160}$/u;

function isValidDetailValue(action: string, key: string, value: unknown): boolean {
  if (key === 'tool') return typeof value === 'string' && TOOL_NAME.test(value);
  if (key === 'route') return typeof value === 'string' && ROUTE_KEY.test(value);
  if (key === 'mode') return value === 'delegation' || value === 'impersonation';
  // A value set per action, so the agent lineage's `via` cannot be spent on a session.
  if (key === 'via') {
    return (
      typeof value === 'string' &&
      (action === 'session.ended'
        ? SESSION_ENDED_VIA
        : action === 'agent.approval_decided'
          ? APPROVAL_VIA
          : AGENT_VIA
      ).includes(value)
    );
  }
  if (
    key === 'instance' ||
    key === 'approval' ||
    key === 'delegation' ||
    key === 'conversation' ||
    key === 'turn'
  ) {
    return typeof value === 'string' && ID.test(value);
  }
  if (key === 'depth' || key === 'count') return Number.isInteger(value) && Number(value) >= 0;
  if (key === 'state') return typeof value === 'string' && AGENT_APPROVAL_STATES.includes(value);
  if (key === 'notice') {
    return value === 'sent' || value === 'skipped_unverified' || value === 'skipped_none';
  }
  if (key === 'also_admits') {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
  if (key === 'breached_check') return BREACHED_CHECK_OUTCOMES.includes(String(value));
  if (
    key === 'user_verified' ||
    key === 'ended_other_sessions' ||
    key === 'carried_over' ||
    key === 'first_password'
  ) {
    return typeof value === 'boolean';
  }
  if (key === 'survivor' || key === 'loser') return typeof value === 'string';
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
    if (key !== 'reason' && !isValidDetailValue(action, key, detail[key])) {
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
