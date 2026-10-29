export { type EmailMessage, type EmailSender } from '#/service/sender';
export {
  renderVerifyEmail,
  renderFinishRegistration,
  type FinishRegistrationInput,
  renderResetPassword,
  renderRequiredActions,
  renderRegistrationDuplicate,
  type RegistrationDuplicateInput,
  renderSecondFactorRemoved,
  renderRecoveryCodesRevoked,
  type SecondFactorRemovedInput,
  type RecoveryCodesRevokedInput,
  renderSmtpTest,
  type VerifyEmailInput,
  type ResetPasswordInput,
  type RequiredActionsInput,
  type SmtpTestInput,
} from '#/service/templates';
export { smtpSender, type SmtpConfig } from '#/adapter/smtp';
export { capturingSender } from '#/adapter/capturing';
export { loggingSender } from '#/adapter/logging';
export { emailOutbox, type OutboxMessage } from '#/schema/outbox';
export { outboxRepository, type ClaimBatch, type EnqueueMessage } from '#/repository/outbox';
export {
  OUTBOX_CLAIM_LEASE_SECONDS,
  retryDelaySeconds,
  sendPending,
  type SendPendingDeps,
  type SendPendingOptions,
  type SendPendingOutcome,
} from '#/usecase/send-pending';
export {
  mailContext,
  tenantMailContext,
  type TenantMailContext,
  type MailBrandingResolver,
  type MailContext,
  type MailOverrides,
  type MailTenantLook,
  type MailTenantScope,
} from '#/usecase/mail-context';
export {
  brandingInScheme,
  inlineMark,
  mailSchemeColours,
  type SchemeColours,
} from '#/service/preview';
export { MAIL_MESSAGES, isMailMessageKey } from '#/service/messages';
