import { type PageLocale, type RenderedPage } from '@odudu/kernel';
import { type RequiredAction } from '#/schema/required-action';
import { page } from '#/view/document';
import { links } from '#/view/links';
import { t, tHtml } from '#/view/messages';
import { fillPage } from '#/view/template';

// Every action has a page of its own — #/view/totp-enrolment-html.ts,
// #/view/update-password-html.ts and their two neighbours — reached before
// this one. What is left here is the deployment that cannot offer an action
// at all: no relying party id, and so no passkey to enrol. The form carries
// nothing to submit, because there is nothing this browser could send that
// would complete it.
export function renderRequiredActionPage(
  action: RequiredAction,
  // The authorize path that starts this sign-in again, when the parked
  // request can be rebuilt: the one way on from a step this server cannot offer.
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  return page(
    t(locale, 'requiredAction.title'),
    fillPage(
      'required-action',
      {
        message: `<h1>${tHtml(locale, 'requiredAction.title')}</h1>
<p>${tHtml(locale, 'requiredAction.pending', {}, { action })}</p>
<p>${tHtml(locale, 'requiredAction.askAdmin')}</p>${
          signInPath === null
            ? ''
            : links([{ href: signInPath, text: tHtml(locale, 'link.backToSignIn') }])
        }`,
      },
      locale,
    ),
    null,
    [],
    locale,
    'required-action',
  );
}
