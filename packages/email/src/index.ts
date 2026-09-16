export { type EmailMessage, type EmailSender } from '#/service/sender';
export {
  renderVerifyEmail,
  renderResetPassword,
  type VerifyEmailInput,
  type ResetPasswordInput,
} from '#/service/templates';
export { smtpSender, type SmtpConfig } from '#/adapter/smtp';
export { capturingSender } from '#/adapter/capturing';
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
