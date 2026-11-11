import { describe, expect, it } from 'vitest';
import {
  consentRevokedEvent,
  credentialRemovedEvent,
  credentialRenamedEvent,
  profileAmendedEvent,
  recoveryCodesRevokedEvent,
  sessionEndedEvent,
  sessionsEndedEvent,
} from '#/service/audit';

const ACTOR = { subjectId: 'subject-1', clientId: 'app' };

describe('the audit events of a person’s own changes', () => {
  it('file a profile edit on the subject, naming the fields and never their values', () => {
    expect(profileAmendedEvent(ACTOR, ['name', 'birthdate'])).toEqual({
      action: 'subject.profile_amend',
      resourceType: 'subject',
      resourceId: 'subject-1',
      actorSubjectId: 'subject-1',
      actorClientKey: 'app',
      detail: { via: 'me', fields: ['name', 'birthdate'] },
    });
  });

  it('file an ended session on the session', () => {
    expect(sessionEndedEvent(ACTOR, 'session-9', true)).toEqual({
      action: 'session.end',
      resourceType: 'session',
      resourceId: 'session-9',
      actorSubjectId: 'subject-1',
      actorClientKey: 'app',
      detail: { via: 'me', current: true },
    });
  });

  it('file the ending of the others on the subject, with how many', () => {
    expect(sessionsEndedEvent(ACTOR, 3, true)).toEqual({
      action: 'session.end_all',
      resourceType: 'subject',
      resourceId: 'subject-1',
      actorSubjectId: 'subject-1',
      actorClientKey: 'app',
      detail: { via: 'me', ended: 3, more: true },
    });
  });

  it('file a revoked consent on the subject, naming the client and the grants ended', () => {
    expect(consentRevokedEvent(ACTOR, 'portal', ['openid', 'email'], 2)).toEqual({
      action: 'consent.revoke',
      resourceType: 'subject',
      resourceId: 'subject-1',
      actorSubjectId: 'subject-1',
      actorClientKey: 'app',
      detail: {
        via: 'me',
        client_id: 'portal',
        scope_names: ['openid', 'email'],
        grants_revoked: 2,
      },
    });
  });

  it('file a renamed authenticator on the subject, never the label', () => {
    expect(credentialRenamedEvent(ACTOR, 'cred-1', 'totp')).toEqual({
      action: 'subject.credential_rename',
      resourceType: 'subject',
      resourceId: 'subject-1',
      actorSubjectId: 'subject-1',
      actorClientKey: 'app',
      detail: { via: 'me', credential_id: 'cred-1', type: 'totp' },
    });
  });

  it('file a removed credential on the subject, naming its id and type', () => {
    expect(credentialRemovedEvent(ACTOR, 'cred-1', 'webauthn')).toEqual({
      action: 'subject.credential_delete',
      resourceType: 'subject',
      resourceId: 'subject-1',
      actorSubjectId: 'subject-1',
      actorClientKey: 'app',
      detail: { via: 'me', credential_id: 'cred-1', type: 'webauthn' },
    });
  });

  it('file the recovery codes a last TOTP took with it', () => {
    expect(recoveryCodesRevokedEvent(ACTOR, 10)).toEqual({
      action: 'subject.recovery_codes_revoke',
      resourceType: 'subject',
      resourceId: 'subject-1',
      actorSubjectId: 'subject-1',
      actorClientKey: 'app',
      detail: { via: 'me', revoked: 10, reason: 'last_factor_removed' },
    });
  });
});
