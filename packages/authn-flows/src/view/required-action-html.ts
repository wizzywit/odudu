import { type RequiredAction } from '#/schema/required-action';

// Minimal, dependency-free HTML, the same choice
// packages/protocol-oidc/src/view/authorize-html.ts and
// packages/account/src/view make: every interpolated value passes through
// escapeHtml so neither the realm name nor the auth session id opens a
// reflected-XSS hole.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Every action has a page of its own — #/view/totp-enrolment-html.ts,
// #/view/update-password-html.ts and their two neighbours — reached before
// this one. What is left here is the deployment that cannot offer an action
// at all: no relying party id, and so no passkey to enrol. The form carries
// nothing to submit, because there is nothing this browser could send that
// would complete it.
export function renderRequiredActionPage(action: RequiredAction): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>One more step</title></head>
<body>
<h1>One more step</h1>
<p>This account has a pending action (${escapeHtml(action)}) that cannot be completed here yet.</p>
<p>Ask an administrator to finish setting up this account.</p>
</body>
</html>`;
}
