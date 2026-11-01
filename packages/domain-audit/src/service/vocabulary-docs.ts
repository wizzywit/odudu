import { type AdminMutationAction } from '#/service/admin-mutation-actions';
import {
  type AuditAction,
  type AuditEventType,
  type AuditOutcome,
  type AuditReason,
  type VocabularyEventType,
} from '#/service/vocabulary';

type VocabularyAction = AuditAction<VocabularyEventType>;

export const AUDIT_EVENT_TYPE_DOCS: Record<AuditEventType, string> = {
  admin_mutation:
    'A write made through the admin API or the `odudu console` command. Its action is free-form: ' +
    'one per mutation, named `<resource>.<verb>`.',
  admin_access:
    'A refusal at the admin API door: an authenticated caller without the capability, or a ' +
    'genuine token from another tenant.',
  authentication:
    'An answer to a sign-in step or to client authentication: a password, one-time code, ' +
    'recovery code or passkey, a second factor offered, a lockout tripped.',
  session: 'A user session was created or ended.',
  token: 'A token was issued, refreshed, exchanged or revoked, or a grant was revoked on reuse.',
  credential:
    'A credential was created or changed: registration, email verification, password reset and ' +
    'change, enrolment of a one-time-code or passkey factor, recovery codes issued.',
};

export const AUDIT_ACTION_DOCS: Record<VocabularyAction, string> = {
  'capability.refused':
    'An authenticated admin caller lacked the capability a route needs. `detail` names it.',
  'token.foreign_issuer':
    'A genuine token issued by another tenant was presented to the admin API.',
  'login.password': 'A password was checked at sign-in.',
  'login.otp': 'A one-time code was checked at sign-in.',
  'login.recovery_code': 'A recovery code was used in place of a second factor.',
  'login.passkey': 'A passkey assertion was checked at sign-in.',
  'factor.offered': 'A second factor was offered to a user who had passed the first.',
  'lockout.tripped': 'Failed sign-ins reached the limit and the subject was locked out.',
  'client.authenticate':
    'A client\u2019s authentication was refused at an endpoint that requires it.',
  'session.created': 'A user session was created by a completed sign-in.',
  'session.ended': 'A user session ended. `detail.via` says by logout, by an admin or by eviction.',
  'token.issue': 'The token endpoint issued tokens, or refused to.',
  'token.refresh': 'A refresh token was redeemed, or the redemption was refused.',
  'token.exchange':
    'A token exchange (RFC 8693) was answered. `detail.mode` says delegation or impersonation.',
  'token.revoke': 'A token was revoked at the revocation endpoint.',
  'grant.revoked_on_reuse':
    'A refresh token was presented again after rotation, so its whole grant was revoked.',
  'grant.revoked_on_code_replay':
    'An authorization code was redeemed a second time, so the grant it produced was revoked.',
  'account.registered': 'A user registered their own account.',
  'account.registration_duplicate':
    'Someone tried to register an email address that already has an account. `resource_id` names that account.',
  'account.address_proved':
    "A reset link proved an unverified address. The account's second factors, passkeys and recovery codes were removed.",
  'email.verified': 'A user verified their email address through the mailed link.',
  'password.reset': 'A password was set through a reset link.',
  'password.changed': 'A user changed their password.',
  'otp.enrolled': 'A user enrolled a one-time-code authenticator.',
  'passkey.enrolled': 'A user enrolled a passkey.',
  'recovery_codes.issued': 'A user was issued a new set of recovery codes.',
};

export const AUDIT_REASON_DOCS: Record<AuditReason, string> = {
  unknown_subject: 'The username or email names no subject.',
  bad_credential: 'The credential presented did not match.',
  locked_out: 'The subject is locked out after too many failures.',
  replayed: 'A credential that can be used once was presented again.',
  already_used: 'The code, token or link was already used.',
  subject_mismatch: 'The credential belongs to another subject than the one signing in.',
  invalid_grant: 'The grant presented is unknown, expired or not usable here.',
  invalid_scope: 'A requested scope is not allowed for this client.',
  invalid_target: 'A requested resource is not allowed for this client.',
  unauthorized_client: 'The client is not allowed to use this grant type.',
  unsupported_token_type: 'The token type is not one the endpoint handles.',
  rate_limited: 'The request was over its budget.',
  foreign_issuer: 'The token was issued by another tenant.',
  missing_capability: 'The caller lacks the admin capability the route requires.',
  already_registered: 'The email address already belongs to an account.',
};

export const AUDIT_OUTCOME_DOCS: Record<AuditOutcome, string> = {
  allowed: 'The action happened.',
  refused: 'The action was refused by a rule: a bad credential, a missing capability, a limit.',
  failed: 'The action was attempted and an error stopped it.',
};

export const ADMIN_MUTATION_ACTION_DOCS: Record<AdminMutationAction, string> = {
  'audit.export': 'The audit trail was exported.',
  'client.amend': 'A client was amended.',
  'client.create': 'A client was created.',
  'client.delete': 'A client was deleted.',
  'client.evaluate': 'The claims a client would receive for a subject were evaluated.',
  'client.grants_revoke': 'Every grant of a client was revoked.',
  'client.rotate_secret': 'A client secret was rotated.',
  'client.secret_expired': 'The retired secret of a rotated client expired and was removed.',
  'consent.revoke': 'A subject’s consent to a client was revoked.',
  'console.assertion':
    'A client assertion for the console was printed by `odudu console assertion`.',
  'flow.replace': 'A tenant’s authentication flow was replaced.',
  'grant.revoke': 'A subject’s grants to a client were revoked.',
  'group.amend': 'A group was amended.',
  'group.create': 'A group was created.',
  'group.default_set': 'A group was made, or stopped being, a default for new subjects.',
  'group.delete': 'A group was deleted.',
  'group.roles_set': 'The roles of a group were replaced.',
  'key.create': 'A signing key was created.',
  'key.delete': 'A retired signing key was deleted.',
  'key.promote': 'A signing key was made the active one.',
  'key.retire': 'A signing key was retired.',
  'message_override.delete': 'A tenant’s own text for a page message was removed.',
  'message_override.set': 'A tenant’s own text for a page message was set or changed.',
  'registration_token.mint': 'An initial access token for dynamic client registration was minted.',
  'registration_token.revoke': 'A registration token was revoked.',
  'role.amend': 'A role was amended.',
  'role.composite_add': 'A role was added to a composite role.',
  'role.composite_remove': 'A role was removed from a composite role.',
  'role.create': 'A role was created.',
  'role.default_set': 'A role was made, or stopped being, a default for new subjects.',
  'role.delete': 'A role was deleted.',
  'scope.amend': 'A client scope was amended.',
  'scope.assign_to_client': 'A client scope was assigned to a client.',
  'scope.create': 'A client scope was created.',
  'scope.delete': 'A client scope was deleted.',
  'scope.mappers_set': 'The claim mappers of a client scope were replaced.',
  'scope.restore_builtins': 'The built-in client scopes a tenant was missing were created again.',
  'scope.roles_set': 'The roles a client scope carries were replaced.',
  'scope.unassign_from_client': 'A client scope was unassigned from a client.',
  'session.end': 'One session was ended by an admin.',
  'session.end_all': 'Every session of a subject, a client or a tenant was ended by an admin.',
  'subject.amend': 'A subject was amended.',
  'subject.create': 'A subject was created.',
  'subject.credential_delete': 'A credential of a subject was deleted.',
  'subject.delete': 'A subject was deleted.',
  'subject.groups_set': 'The groups of a subject were replaced.',
  'subject.lockout_clear': 'A subject’s lockout was cleared.',
  'subject.lockouts_clear': 'The lockouts of many subjects were cleared in one call.',
  'subject.password_issue': 'A password was set for a subject by an admin.',
  'subject.password_reset_send': 'A password reset link was mailed to a subject by an admin.',
  'subject.verification_send': 'An email verification link was mailed to a subject by an admin.',
  'subject.actions_email_send':
    'A mail asking a subject to complete required actions was sent by an admin.',
  'subject.profile_amend': 'A subject’s profile claims were amended.',
  'subject.recovery_codes_revoke': 'A subject’s recovery codes were revoked.',
  'subject.required_actions_set': 'The required actions of a subject were replaced.',
  'subject.roles_set': 'The roles of a subject were replaced.',
  'tenant.amend': 'A tenant was amended.',
  'tenant.amend_settings': 'A tenant’s settings were amended.',
  'tenant.create': 'A tenant was created.',
  'tenant.delete': 'A tenant was deleted.',
  'tenant.export': 'A tenant was exported.',
  'tenant.import': 'A tenant was imported.',
  'tenant.smtp_delete': 'A tenant’s SMTP relay was removed.',
  'tenant.smtp_set': 'A tenant’s SMTP relay was set.',
  'tenant.smtp_test': 'A test message was sent through a tenant’s SMTP relay.',
  'theme.asset_deleted': 'An image uploaded for a tenant’s themes was deleted.',
  'theme.asset_uploaded':
    'An image was uploaded for a tenant’s themes, including bytes the tenant already stored.',
  'theme.draft_discarded':
    'The draft of a tenant’s or a client’s theme was discarded; the published theme stayed.',
  'theme.draft_saved': 'The draft of a tenant’s or a client’s theme was saved.',
  'theme.published': 'The draft of a tenant’s or a client’s theme was published.',
  'theme.reset': 'A tenant’s theme was reset to the default, or a client’s to its tenant’s.',
  'theme.restored': 'An earlier version of a theme was published again.',
};
