import { type RenderedPage } from '@odudu/kernel';
import { type RequiredAction } from '#/schema/required-action';
import { escapeHtml, page } from '#/view/document';

// Every action has a page of its own — #/view/totp-enrolment-html.ts,
// #/view/update-password-html.ts and their two neighbours — reached before
// this one. What is left here is the deployment that cannot offer an action
// at all: no relying party id, and so no passkey to enrol. The form carries
// nothing to submit, because there is nothing this browser could send that
// would complete it.
export function renderRequiredActionPage(action: RequiredAction): RenderedPage {
  return page(
    'One more step',
    `<h1>One more step</h1>
<p>This account has a pending action (${escapeHtml(action)}) that cannot be completed here yet.</p>
<p>Ask an administrator to finish setting up this account.</p>`,
  );
}
