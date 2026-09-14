import type { EmailMessage } from '#/service/sender';

export interface VerifyEmailInput {
  readonly to: string;
  readonly link: string;
  readonly realmDisplayName: string;
}

export interface ResetPasswordInput {
  readonly to: string;
  readonly link: string;
  readonly realmDisplayName: string;
}

// realmDisplayName is operator-supplied and lands in an HTML body a mail
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
  const realmName = escapeHtml(input.realmDisplayName);
  return {
    to: input.to,
    subject: `Verify your ${input.realmDisplayName} account`,
    text: `Confirm your email address for ${input.realmDisplayName} by visiting this link:\n\n${input.link}\n\nIf you did not request this, you can ignore this message.`,
    html: `<p>Confirm your email address for ${realmName} by visiting <a href="${input.link}">${input.link}</a>.</p><p>If you did not request this, you can ignore this message.</p>`,
  };
}

export function renderResetPassword(input: ResetPasswordInput): EmailMessage {
  const realmName = escapeHtml(input.realmDisplayName);
  return {
    to: input.to,
    subject: `Reset your ${input.realmDisplayName} password`,
    text: `Reset your password for ${input.realmDisplayName} by visiting this link:\n\n${input.link}\n\nIf you did not request this, you can ignore this message.`,
    html: `<p>Reset your password for ${realmName} by visiting <a href="${input.link}">${input.link}</a>.</p><p>If you did not request this, you can ignore this message.</p>`,
  };
}
