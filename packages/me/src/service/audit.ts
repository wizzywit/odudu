import type { AdminMutationAction } from '@odudu/domain-audit';

// An audit row for something a person did to their own account through the me
// API. The actor is the subject themselves, acting through the client the token
// was issued to; the write fills in the client's row id from its `client_id`.
export interface MeAuditEvent {
  readonly action: Extract<
    AdminMutationAction,
    | 'subject.profile_amend'
    | 'session.end'
    | 'session.end_all'
    | 'consent.revoke'
    | 'subject.credential_rename'
    | 'subject.credential_delete'
    | 'subject.recovery_codes_revoke'
  >;
  readonly resourceType: 'subject' | 'session';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorClientKey: string;
  readonly detail: Record<string, unknown>;
}

export interface Actor {
  readonly subjectId: string;
  readonly clientId: string;
}

const VIA = { via: 'me' } as const;

function onSubject(
  actor: Actor,
  action: MeAuditEvent['action'],
  detail: Record<string, unknown>,
): MeAuditEvent {
  return {
    action,
    resourceType: 'subject',
    resourceId: actor.subjectId,
    actorSubjectId: actor.subjectId,
    actorClientKey: actor.clientId,
    detail: { ...VIA, ...detail },
  };
}

// The fields are named and never their values: a birthdate or an address is a
// stronger identifier than the audit trail should hold.
export function profileAmendedEvent(actor: Actor, fields: readonly string[]): MeAuditEvent {
  return onSubject(actor, 'subject.profile_amend', { fields: [...fields] });
}

export function sessionEndedEvent(actor: Actor, sessionId: string, current: boolean): MeAuditEvent {
  return {
    action: 'session.end',
    resourceType: 'session',
    resourceId: sessionId,
    actorSubjectId: actor.subjectId,
    actorClientKey: actor.clientId,
    detail: { ...VIA, current },
  };
}

export function sessionsEndedEvent(actor: Actor, ended: number, more: boolean): MeAuditEvent {
  return onSubject(actor, 'session.end_all', { ended, more });
}

export function consentRevokedEvent(
  actor: Actor,
  clientKey: string,
  scopeNames: readonly string[],
  grantsRevoked: number,
): MeAuditEvent {
  return onSubject(actor, 'consent.revoke', {
    client_id: clientKey,
    scope_names: [...scopeNames],
    grants_revoked: grantsRevoked,
  });
}

export function credentialRenamedEvent(
  actor: Actor,
  credentialId: string,
  type: string,
): MeAuditEvent {
  return onSubject(actor, 'subject.credential_rename', {
    credential_id: credentialId,
    type,
  });
}

export function credentialRemovedEvent(
  actor: Actor,
  credentialId: string,
  type: string,
): MeAuditEvent {
  return onSubject(actor, 'subject.credential_delete', {
    credential_id: credentialId,
    type,
  });
}

// Recovery codes stand in only for a TOTP, so the last TOTP takes them along.
export function recoveryCodesRevokedEvent(actor: Actor, revoked: number): MeAuditEvent {
  return onSubject(actor, 'subject.recovery_codes_revoke', {
    revoked,
    reason: 'last_factor_removed',
  });
}

// An address is asked for and not yet proved: the field is named and the
// address never. `skipped` says why no mail went, for an address that cannot
// be proved by mail to the person asking.
export function emailChangeRequestedEvent(
  actor: Actor,
  skipped: 'address_in_use' | 'unchanged' | 'throttled' | null,
): MeAuditEvent {
  return onSubject(
    actor,
    'subject.profile_amend',
    skipped === null ? { fields: ['email'], pending: true } : { fields: ['email'], skipped },
  );
}
