import type { EmailMessage } from '#/service/sender';

export interface VerifyEmailInput {
  readonly to: string;
  readonly link: string;
  readonly tenantDisplayName: string;
}

export interface ResetPasswordInput {
  readonly to: string;
  readonly link: string;
  readonly tenantDisplayName: string;
}

// tenantDisplayName is operator-supplied and lands in an HTML body a mail
// client renders — escape it, never the link, which this package builds
// itself.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderVerifyEmail(input: VerifyEmailInput): EmailMessage {
  const tenantName = escapeHtml(input.tenantDisplayName);
  return {
    to: input.to,
    subject: `Verify your ${input.tenantDisplayName} account`,
    text: `Confirm your email address for ${input.tenantDisplayName} by visiting this link:\n\n${input.link}\n\nIf you did not request this, you can ignore this message.`,
    html: `<p>Confirm your email address for ${tenantName} by visiting <a href="${input.link}">${input.link}</a>.</p><p>If you did not request this, you can ignore this message.</p>`,
  };
}

export function renderResetPassword(input: ResetPasswordInput): EmailMessage {
  const tenantName = escapeHtml(input.tenantDisplayName);
  return {
    to: input.to,
    subject: `Reset your ${input.tenantDisplayName} password`,
    text: `Reset your password for ${input.tenantDisplayName} by visiting this link:\n\n${input.link}\n\nIf you did not request this, you can ignore this message.`,
    html: `<p>Reset your password for ${tenantName} by visiting <a href="${input.link}">${input.link}</a>.</p><p>If you did not request this, you can ignore this message.</p>`,
  };
}

export interface RequiredActionsInput {
  readonly to: string;
  readonly link: string;
  readonly tenantDisplayName: string;
  /** What each action asks of the subject, in the order it will be asked. */
  readonly actions: readonly string[];
}

export function renderRequiredActions(input: RequiredActionsInput): EmailMessage {
  const tenantName = escapeHtml(input.tenantDisplayName);
  const listed = input.actions.map((action) => `- ${action}`).join('\n');
  const items = input.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('');
  return {
    to: input.to,
    subject: `Update your ${input.tenantDisplayName} account`,
    text: `Your administrator asks you to update your ${input.tenantDisplayName} account:\n\n${listed}\n\nDo so by visiting this link:\n\n${input.link}\n\nIf you were not expecting this, you can ignore this message.`,
    html: `<p>Your administrator asks you to update your ${tenantName} account:</p><ul>${items}</ul><p>Do so by visiting <a href="${input.link}">${input.link}</a>.</p><p>If you were not expecting this, you can ignore this message.</p>`,
  };
}
