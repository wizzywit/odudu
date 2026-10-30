import { scriptNonce, type PageLocale, type RenderedPage } from '@odudu/kernel';
import { escapeHtml, page } from '#/view/document';
import { fillPage } from '#/view/template';
import { t, tHtml } from '#/view/messages';

function hiddenField(name: string, value: string | null): string {
  return value === null
    ? ''
    : `\n  <input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

// What the pages that end a session fill `logged-out` with: `message` is the
// whole of their text, `frames` and `script` are empty unless the page has
// any, and `links` is unused because no page of this kind has a way on.
function textOnly(message: string): Record<string, string> {
  return { message, links: '', frames: '', script: '' };
}

function framed(message: string, iframes: string): Record<string, string> {
  return { ...textOnly(message), frames: `\n${iframes}` };
}

export interface LogoutConfirmationFields {
  clientId: string | null;
  postLogoutRedirectUri: string | null;
  state: string | null;
}

// RP-Initiated Logout 1.0 §2's confirmation page. `sessionId` is public —
// it is every token's `sid` — so the defence is `csrf`, an HMAC keyed by the
// secret half of the cookie's entry, which the POST recomputes from the
// entry the browser presents; SameSite=Lax and the membership check stand
// beside it. Ending a session on a bare GET would let an `<img>` tag on any
// page log the End-User out — this form keeps it a POST from this browser.
export function renderLogoutConfirmationPage(
  tenant: string,
  sessionId: string,
  csrf: string,
  fields: LogoutConfirmationFields,
  locale: PageLocale,
): RenderedPage {
  const action = `/tenants/${escapeHtml(encodeURIComponent(tenant))}/protocol/openid-connect/logout`;
  return page(
    t(locale, 'logout.confirm.title'),
    fillPage(
      'logout-confirm',
      {
        'form.open': `<form method="post" action="${action}">
  <input type="hidden" name="session_id" value="${escapeHtml(sessionId)}">
  <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${hiddenField('client_id', fields.clientId)}${hiddenField('post_logout_redirect_uri', fields.postLogoutRedirectUri)}${hiddenField('state', fields.state)}`,
        submit: `<button type="submit">${tHtml(locale, 'logout.confirm.submit')}</button>`,
        'form.close': '</form>',
      },
      locale,
    ),
    null,
    [],
    locale,
    'logout-confirm',
  );
}

// Reached when there is no live session to end at all — a missing or
// expired cookie, or one scoped to a different tenant. Nothing to confirm,
// so no form: confirming would end nothing anyway.
export function renderNoActiveSessionPage(locale: PageLocale): RenderedPage {
  return page(
    t(locale, 'logout.noSession.title'),
    fillPage(
      'logged-out',
      textOnly(`<h1>${tHtml(locale, 'logout.noSession.title')}</h1>
<p>${tHtml(locale, 'logout.noSession.body')}</p>`),
      locale,
    ),
    null,
    [],
    locale,
    'logged-out',
  );
}

// The session ended, and there was nowhere the request asked to send the
// End-User back to (no post_logout_redirect_uri at all) — Front-Channel
// Logout 1.0 §3's page: one <iframe> per relying party that registered a
// front-channel logout URI and held a grant under the ended session. This
// is the OP's whole obligation under that section; §4.1's third-party
// cookie behaviour decides whether a framed RP ever sees the request (see
// docs/superpowers/p3b-spike-frontchannel.md), which this function cannot
// know and does not claim to.
export function renderLoggedOutPage(
  frontChannelLogoutUrls: readonly string[] = [],
  locale: PageLocale,
): RenderedPage {
  const iframes = frontChannelLogoutUrls
    .map((url) => `<iframe src="${escapeHtml(url)}"></iframe>`)
    .join('\n');
  return page(
    t(locale, 'logout.done.title'),
    fillPage(
      'logged-out',
      framed(
        `<h1>${tHtml(locale, 'logout.done.title')}</h1>
<p>${tHtml(locale, 'logout.done.body')}</p>`,
        iframes,
      ),
      locale,
    ),
    null,
    frontChannelLogoutUrls.map((url) => new URL(url).origin),
    locale,
    'logged-out',
  );
}

// How long the frames get before the browser moves on, and how long a
// browser without script waits. The script is the quick path, the meta
// refresh the one a policy or a setting cannot take away.
const FRAME_WAIT_MS = 2000;
const NO_SCRIPT_WAIT_SECONDS = 5;

// The session ended and the request named a matched post_logout_redirect_uri
// (RP-Initiated Logout 1.0 §3), but relying parties registered front-channel
// logout URIs, and a redirect now would leave before any frame loaded
// (Front-Channel Logout 1.0 §3). `redirectTo` is the address the route
// already matched. The script reads it from the page's own link, so nothing
// is spliced into script; it leaves when every frame has loaded or the wait
// is up. It starts at DOMContentLoaded, so where a theme places it is
// immaterial.
export function renderLoggedOutRedirectPage(
  frontChannelLogoutUrls: readonly string[],
  redirectTo: string,
  locale: PageLocale,
): RenderedPage {
  const iframes = frontChannelLogoutUrls
    .map((url) => `<iframe src="${escapeHtml(url)}"></iframe>`)
    .join('\n');
  const target = escapeHtml(redirectTo);
  const nonce = scriptNonce();
  return page(
    t(locale, 'logout.done.title'),
    fillPage(
      'logged-out',
      {
        ...framed(
          `<meta http-equiv="refresh" content="${String(NO_SCRIPT_WAIT_SECONDS)};url=${target}">
<h1>${tHtml(locale, 'logout.done.title')}</h1>
<p>${tHtml(locale, 'logout.redirecting.body')}</p>
<p><a id="continue" href="${target}">${tHtml(locale, 'logout.redirecting.continue')}</a></p>`,
          iframes,
        ),
        script: `\n<script nonce="${nonce}">
(function () {
  function start() {
    var next = document.getElementById('continue').href;
    var frames = document.querySelectorAll('iframe');
    var pending = frames.length;
    var left = false;
    function leave() { if (!left) { left = true; location.replace(next); } }
    frames.forEach(function (frame) {
      frame.addEventListener('load', function () {
        if (frame.dataset.seen) return;
        frame.dataset.seen = '1';
        pending -= 1;
        if (pending === 0) leave();
      });
    });
    setTimeout(leave, ${String(FRAME_WAIT_MS)});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
</script>`,
      },
      locale,
    ),
    { nonce, fetchesSameOrigin: false },
    frontChannelLogoutUrls.map((url) => new URL(url).origin),
    locale,
    'logged-out',
  );
}

// The session still ended — RP-Initiated Logout 1.0's redirect rule (§3) is
// about the redirect alone, and refusing it must not look like refusing the
// logout itself, or an attacker's unmatched redirect_uri would be a way to
// keep a session alive. Frames each relying party's front-channel logout
// URI exactly as `renderLoggedOutPage` does — this page renders too, rather
// than redirecting, so the same iframe opportunity applies.
export function renderLogoutRedirectRefusedPage(
  frontChannelLogoutUrls: readonly string[] = [],
  locale: PageLocale,
): RenderedPage {
  const iframes = frontChannelLogoutUrls
    .map((url) => `<iframe src="${escapeHtml(url)}"></iframe>`)
    .join('\n');
  return page(
    t(locale, 'logout.done.title'),
    fillPage(
      'logged-out',
      framed(
        `<h1>${tHtml(locale, 'logout.done.title')}</h1>
<p>${tHtml(locale, 'logout.redirectRefused.body')}</p>`,
        iframes,
      ),
      locale,
    ),
    null,
    frontChannelLogoutUrls.map((url) => new URL(url).origin),
    locale,
    'logged-out',
  );
}

// The confirmation form's CSRF defence failed — the hidden session id does
// not name the session the cookie itself resolves to. Nothing was ended;
// see #/usecase/logout.ts's `unauthenticated` outcome.
export function renderLogoutUnauthenticatedPage(locale: PageLocale): RenderedPage {
  return page(
    t(locale, 'logout.unauthenticated.title'),
    fillPage(
      'logged-out',
      textOnly(`<h1>${tHtml(locale, 'logout.unauthenticated.title')}</h1>
<p>${tHtml(locale, 'logout.unauthenticated.body')}</p>`),
      locale,
    ),
    null,
    [],
    locale,
    'logged-out',
  );
}
