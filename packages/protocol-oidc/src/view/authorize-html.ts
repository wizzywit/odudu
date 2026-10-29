import { type PageLocale, scriptNonce, type RenderedPage } from '@odudu/kernel';
import { escapeHtml, intro, page } from '#/view/document';
import { links } from '#/view/links';
import { fillPage } from '#/view/template';
import {
  firstInvalidField,
  invalidAttributes,
  problemSummary,
  type Problem,
} from '#/view/form-error';
import { type LoginWays } from '#/service/login-ways';
import { type RefusalMessageId } from '#/view/login-messages';
import { bdi, t, tHtml, type MessageId } from '#/view/messages';

// Where an expired sign-in can go on from. Both hrefs are built from a
// request /authorize already validated: the restart one is this server's own
// authorize path, the return one the client's registered redirect_uri.
export interface WayOn {
  kind: 'restart' | 'return';
  href: string;
}

const WAY_ON_LABEL: Record<WayOn['kind'], MessageId> = {
  restart: 'error.wayOn.restart',
  return: 'error.wayOn.return',
};

export function renderAuthorizeErrorPage(
  error: string,
  description: string,
  wayOn: WayOn | undefined,
  locale: PageLocale,
): RenderedPage {
  const link =
    wayOn === undefined
      ? ''
      : `\n<p><a href="${escapeHtml(wayOn.href)}">${tHtml(locale, WAY_ON_LABEL[wayOn.kind])}</a></p>`;
  return page(
    t(locale, 'error.title'),
    fillPage(
      'authorize-error',
      {
        message: `<h1>${tHtml(locale, 'error.heading')}</h1>\n<p>${bdi(description)}</p>`,
        links: link,
        code: `\n<p><small>${escapeHtml(error)}</small></p>`,
      },
      locale,
    ),
    null,
    [],
    locale,
    'authorize-error',
  );
}

// No auth_session_id here, unlike renderLoginForm below: this page has no
// form to resubmit, since the next step happens in the user's inbox, not on
// this page. `hasEmail` false means there is no address on file at all — a
// tenant turning verify_email on locks these accounts out with nothing they
// can do about it, so the page says that rather than claiming a mail it
// never sent.
export function renderEmailUnverifiedPage(
  hasEmail: boolean,
  // The authorize path that starts this sign-in again, when the parked
  // request can be rebuilt.
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  return page(
    t(locale, 'emailUnverified.title'),
    fillPage(
      'email-unverified',
      {
        message: `<h1>${tHtml(locale, 'emailUnverified.heading')}</h1>
<p>${tHtml(locale, 'emailUnverified.body', { mail: hasEmail ? 'sent' : 'none' })}</p>`,
        links:
          signInPath === null
            ? ''
            : links([{ href: signInPath, text: tHtml(locale, 'link.backToSignIn') }]),
      },
      locale,
    ),
    null,
    [],
    locale,
    'email-unverified',
  );
}

// One of the ten single-use codes a generate-recovery-codes page issued.
// `autocomplete="off"`: a password manager holding the whole list would
// offer to fill the same code every time, and each works once.
const recoveryCodeField = (attributes: string, locale: PageLocale): string =>
  `<label>${tHtml(locale, 'login.recoveryCode.label')} <input type="text" name="recovery_code" autocomplete="off"${attributes}></label>`;

// `form` names the authenticator to render fields for (an authn-flows
// registry key, e.g. 'password') — not a fixed enum, so a new authenticator
// adds a case here rather than a schema change.
const DEFAULT_LABELS = ['login.title', 'login.submit'] as const;
const FORM_LABELS: Record<string, readonly [MessageId, MessageId]> = {
  otp: ['login.otp.title', 'login.verify'],
  'recovery-code': ['login.recoveryCode.title', 'login.verify'],
};

// Reflection is bounded, not validated: a name past this many code points is
// not given back at all, because half of a 1 MB string is still reflected
// input. Code points, not UTF-16 units, so an emoji name counts as it reads;
// the length test short-circuits so a huge value is never walked.
const MAX_ECHOED_USERNAME_LENGTH = 254;

function codePointCount(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    const pairedHigh = unit >= 0xd800 && unit <= 0xdbff;
    if (pairedHigh && index + 1 < value.length) index += 1;
    count += 1;
  }
  return count;
}

function isEchoable(username: string): boolean {
  return (
    username.length > 0 &&
    username.length <= MAX_ECHOED_USERNAME_LENGTH * 2 &&
    codePointCount(username) <= MAX_ECHOED_USERNAME_LENGTH
  );
}

// What a refused step gives back to the person. Only the username ever
// travels: a password, a code or a recovery code is never put back in a field.
export interface LoginFormRefusal {
  messageId: RefusalMessageId;
  username?: string;
}

// The fields a refusal is about: the step's own inputs, so a screen reader
// lands on the one to correct. A wrong password or an unknown name read alike
// (see login-messages.ts), so both fields of that step are marked.
const REFUSED_FIELDS: Record<RefusalMessageId, readonly string[]> = {
  'login.refusal.signInFailed': ['username', 'password'],
  'login.refusal.codeFailed': ['code'],
  'login.refusal.recoveryCodeFailed': ['recovery_code'],
  'login.refusal.alreadyUsedRecoveryCode': ['recovery_code'],
};

// Where the cursor goes after a refusal, without a script: the first of these
// the refusal is about. On the password step that is the username unless it
// was given back, then the password.
function focusOrder(form: string, echoed: boolean): string[] {
  if (form === 'otp') return ['code', 'recovery_code'];
  if (form === 'recovery-code') return ['recovery_code'];
  return echoed ? ['password', 'username'] : ['username', 'password'];
}

function renderFormFields(
  form: string,
  loginWithEmail: boolean,
  refusal: LoginFormRefusal | undefined,
  problems: readonly Problem[],
  locale: PageLocale,
): string {
  const echoed =
    refusal?.username !== undefined && isEchoable(refusal.username) ? refusal.username : undefined;
  const focus = firstInvalidField(problems, focusOrder(form, echoed !== undefined));
  const state = (field: string): string =>
    `${invalidAttributes(problems, field)}${focus === field ? ' autofocus' : ''}`;
  if (form === 'password') {
    const label = tHtml(locale, loginWithEmail ? 'login.usernameOrEmail' : 'login.username');
    const value = echoed === undefined ? '' : ` value="${escapeHtml(echoed)}"`;
    return `<label>${label} <input type="text" name="username" autocomplete="username"${value}${state('username')}></label>
  <label>${tHtml(locale, 'login.password')} <input type="password" name="password" autocomplete="current-password"${state('password')}></label>`;
  }
  // No username: which account the code is checked against comes from the
  // authentication session the hidden field names, never from this form.
  // The recovery field sits beside the app's code rather than behind a
  // second page, because somebody reaching for it has already lost the
  // thing the first field asks for. Filling either one is a submission;
  // filling both spends the recovery code, which runs first.
  if (form === 'otp') {
    return `<label>${tHtml(locale, 'login.otp.code')} <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"${state('code')}></label>
  ${recoveryCodeField(state('recovery_code'), locale)}`;
  }
  if (form === 'recovery-code') {
    return recoveryCodeField(state('recovery_code'), locale);
  }
  // Unreachable today: the two authenticators with fields to render are
  // the two above, and a passkey has none — it is offered by
  // renderPasskeyOption below rather than as a set of inputs.
  return `<p>${tHtml(locale, 'login.unsupportedStep', { form })}</p>`;
}

// Where the browser's own reason goes in the failure sentence: the server
// formats the sentence in the page's language around this marker, and the
// script swaps the marker for the reason, which only the browser knows.
const REASON = '{reason}';

// navigator.credentials.get() is the only way to produce an assertion, so
// the passkey half of this page cannot be a plain form: the script asks the
// server for options, asks the authenticator, then posts what it returns.
// No username anywhere in it — the options name no credentials, so the
// browser offers every discoverable one it holds and the account is
// whichever one answers. The challenge is issued per click rather than with
// the page, so a form left open overnight still gets a live one.
function renderPasskeyOption(
  tenant: string,
  authSessionId: string,
  nonce: string,
  locale: PageLocale,
): string {
  // The <p> keeps the button clear of the sign-in one (WCAG 2.2 target size).
  const escaped = escapeHtml(encodeURIComponent(tenant));
  return `
<form method="post" action="/tenants/${escaped}/login-actions/authenticate" id="passkey-form" data-failed="${tHtml(locale, 'login.passkey.failed', { reason: REASON })}" data-cancelled="${tHtml(locale, 'login.passkey.cancelled')}" data-not-offered="${tHtml(locale, 'login.passkey.notOffered')}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">
  <input type="hidden" name="assertion" id="passkey-assertion">
  <p><button type="submit" id="passkey-submit" class="secondary">${tHtml(locale, 'login.passkey.submit')}</button></p>
</form>
<p id="passkey-error" class="alert" role="alert" hidden></p>
<noscript><p>${tHtml(locale, 'login.passkey.needsScript')}</p></noscript>
<script nonce="${escapeHtml(nonce)}">
const form = document.getElementById('passkey-form');
const field = document.getElementById('passkey-assertion');
const failure = document.getElementById('passkey-error');
const fromBase64Url = (value) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
form.addEventListener('submit', async (event) => {
  if (field.value !== '') return;
  event.preventDefault();
  failure.hidden = true;
  try {
    const offered = await fetch('/tenants/${escaped}/login-actions/passkey-challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ auth_session_id: form.auth_session_id.value }),
    });
    if (!offered.ok) throw new Error(form.dataset.notOffered);
    const options = await offered.json();
    const assertion = await navigator.credentials.get({
      publicKey: { ...options, challenge: fromBase64Url(options.challenge) },
    });
    field.value = JSON.stringify(assertion.toJSON());
    form.submit();
  } catch (caught) {
    const reason = caught && caught.message ? caught.message : form.dataset.cancelled;
    failure.textContent = form.dataset.failed.replace('${REASON}', () => reason);
    failure.hidden = false;
  }
});
</script>`;
}

// Forgot password first, since it is the one a person who is already here
// needs; both are paths on this server, built by loginWays.
function waysHtml(ways: LoginWays, locale: PageLocale): string {
  return links([
    ...(ways.resetPassword === undefined
      ? []
      : [{ href: ways.resetPassword, text: tHtml(locale, 'login.link.forgotPassword') }]),
    ...(ways.createAccount === undefined
      ? []
      : [{ href: ways.createAccount, text: tHtml(locale, 'login.link.createAccount') }]),
  ]);
}

// The hidden field is the whole of this page's CSRF defence: authSessionId
// is an unguessable id (newId()) that only a browser which actually loaded
// this response — rendered same-origin, never carried in a URL an attacker
// could read or replay — can submit back. POST /tenants/{tenant}/login-actions/authenticate
// treats a submission whose auth_session_id does not name a live authentication
// session as unauthenticated, exactly as it would treat a missing token. It is
// on every form this function renders, not just the password one, since it is
// what CSRF-protects the whole endpoint rather than any one authenticator.
export function renderLoginForm(
  tenant: string,
  authSessionId: string,
  form: string,
  // Whether this deployment can offer a passkey at all: the relying party
  // id comes from ODUDU_PUBLIC_BASE_URL and nowhere else, so without that
  // there is nothing behind the button.
  passkeyLogin = false,
  // Whether the tenant's `remember_me_allowed` setting is on. The checkbox
  // is offered on that authority alone; login-submission.ts applies the
  // same gate again when the form comes back, so nothing here needs to be
  // trusted for more than what to render.
  rememberMeAllowed = false,
  // Shown above the fields after a refused step — see
  // LoginSubmissionOutcome's `reject`.
  refusal: LoginFormRefusal | undefined,
  // The tenant's `login_with_email`: only the label changes, since the
  // field takes either and the server decides which it names.
  loginWithEmail = false,
  // The name of the client the parked request is for, when there is one.
  clientName: string | undefined,
  // The pages beside this form the tenant serves, offered under it on the
  // first-factor step only.
  ways: LoginWays,
  locale: PageLocale,
): RenderedPage {
  const action = `/tenants/${escapeHtml(encodeURIComponent(tenant))}/login-actions/authenticate`;
  // Beside the password and nowhere else: a passkey is an alternative to
  // the first factor, not to a code asked for after one. The nonce is minted
  // here, where it is known whether a script is going to be rendered at
  // all, so the policy sent with this page never licenses one it does not
  // carry.
  const nonce = passkeyLogin && form === 'password' ? scriptNonce() : null;
  const passkey = nonce === null ? '' : renderPasskeyOption(tenant, authSessionId, nonce, locale);
  const problems: Problem[] =
    refusal === undefined
      ? []
      : [{ fields: REFUSED_FIELDS[refusal.messageId], html: tHtml(locale, refusal.messageId) }];
  // Never rendered at all when the tenant has not turned the setting on —
  // login-submission.ts's own gate is the one that matters, but a checkbox
  // this tenant could never honour is not offered in the first place.
  const rememberMe = rememberMeAllowed
    ? `\n  <label><input type="checkbox" name="remember_me" id="remember-me" value="true"> ${tHtml(locale, 'login.rememberMe')}</label>`
    : '';
  const [title, submit] = Object.hasOwn(FORM_LABELS, form)
    ? (FORM_LABELS[form] ?? DEFAULT_LABELS)
    : DEFAULT_LABELS;
  return {
    ...page(
      t(locale, title),
      fillPage(
        'sign-in',
        {
          intro: intro(
            tHtml(locale, title),
            tenant,
            clientName === undefined
              ? []
              : [tHtml(locale, 'login.context', {}, { client: clientName })],
          ),
          error: problemSummary(problems),
          'form.open': `<form method="post" action="${action}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">`,
          fields: `${renderFormFields(form, loginWithEmail, refusal, problems, locale)}${rememberMe}`,
          submit: `<button type="submit">${tHtml(locale, submit)}</button>`,
          'form.close': '</form>',
          passkey,
          links: form === 'password' ? waysHtml(ways, locale) : '',
        },
        locale,
      ),
      null,
      [],
      locale,
      'sign-in',
    ),
    script: nonce === null ? null : { nonce, fetchesSameOrigin: true },
  };
}
