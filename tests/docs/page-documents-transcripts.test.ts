import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_LOCALE as LOCALE,
  pathAddress,
  type PasswordRules,
} from '../../packages/kernel/src/index.js';
import {
  renderAuthorizeErrorPage,
  type WayOn,
} from '../../packages/protocol-oidc/src/view/authorize-html.js';
import { renderConsentPage } from '../../packages/protocol-oidc/src/view/consent-html.js';
import { page } from '../../packages/protocol-oidc/src/view/document.js';
import {
  renderLoggedOutPage,
  renderLogoutConfirmationPage,
  renderLogoutUnauthenticatedPage,
  renderNoActiveSessionPage,
} from '../../packages/protocol-oidc/src/view/logout-html.js';
import { renderSelectAccountPage } from '../../packages/protocol-oidc/src/view/select-account-html.js';
import { renderThrottledPage } from '../../packages/protocol-oidc/src/view/throttled-html.js';
import {
  renderRegistrationFailedPage,
  renderRegistrationForm,
  renderRegistrationReadyPage,
  renderRegistrationSucceededPage,
  type RegistrationFailure,
  type RegistrationRefusal,
} from '../../packages/account/src/view/registration-html.js';
import {
  renderResetLinkFailedPage,
  renderResetPasswordForm,
  renderResetPasswordSucceededPage,
  renderResetRequestedPage,
  renderResetRequestFailedPage,
  renderResetRequestForm,
} from '../../packages/account/src/view/reset-html.js';
import { type PasswordFailure } from '../../packages/account/src/view/password-rules.js';
import {
  renderRequiredActionsForm,
  renderRequiredActionsSucceededPage,
} from '../../packages/account/src/view/required-actions-html.js';
import {
  renderVerificationFailedPage,
  renderEmailConfirmPage,
  renderVerificationSucceededPage,
} from '../../packages/account/src/view/verification-html.js';
import { renderSignInRefused } from '../../packages/console-gateway/src/view/refusal-html.js';
import { renderRecoveryCodesPage } from '../../packages/authn-flows/src/view/recovery-codes-html.js';
import { renderTotpEnrolmentPage } from '../../packages/authn-flows/src/view/totp-enrolment-html.js';
import { renderUpdatePasswordPage } from '../../packages/authn-flows/src/view/update-password-html.js';
import { ADMIN_PAGES, CONSOLE_PAGES, loadSource, PROTOCOL_PAGES, scanFences } from './markdown.js';

// A recorded page response is a claim about bytes: its `content-length` is
// the length of the document under it, and the document is the shell around
// the page's own markup. A block that shows only part of a document says so
// with a `…` in its body; every other block is held to the shell and, where
// it shows a `content-length`, to that length.
const GUIDES = [PROTOCOL_PAGES, CONSOLE_PAGES, ADMIN_PAGES];
const MARKER = '@@';

interface Recorded {
  readonly where: string;
  readonly lines: readonly string[];
}

function recorded(): Recorded[] {
  return GUIDES.flatMap((guide) =>
    scanFences(loadSource(guide)).spans.flatMap((span) => {
      const start = span.body.indexOf('<!doctype html>');
      const page = span.body.some((line) =>
        line.startsWith("content-security-policy: default-src 'none'"),
      );
      if (!(span.body[0] ?? '').startsWith('HTTP/1.1 ') || start === -1 || !page) return [];
      return [{ where: `${guide}:${String(span.startLine)}`, lines: span.body }];
    }),
  );
}

// A fence may go on to hold the next command, so the document ends at its own
// closing tag when it has one.
function documentOf(block: Recorded): string[] {
  const rest = block.lines.slice(block.lines.indexOf('<!doctype html>'));
  const end = rest.indexOf('</html>');
  return end === -1 ? rest : rest.slice(0, end + 1);
}
const isPartial = (block: Recorded): boolean =>
  documentOf(block).some((line) => line.includes('…'));
const complete = (): Recorded[] => recorded().filter((block) => !isPartial(block));

// reloadOnRestore appends this after the shell's closing `</main>`.
const RELOAD_ON_RESTORE =
  /\n<script nonce="[^"]*">window\.addEventListener\('pageshow'[^\n]*<\/script>\n<\/body>/u;

// The shell around a page, split where a title and a body go.
const [BEFORE_TITLE = '', BETWEEN = '', AFTER_BODY = ''] = page(MARKER, MARKER).html.split(MARKER);

// The title is recorded as served, escaped; page() escapes what it is given.
const unescaped = (text: string): string =>
  text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&');

describe('the page documents the guides record', () => {
  it('finds complete documents in every guide, so an empty scan cannot pass', () => {
    for (const guide of GUIDES) {
      expect(
        complete().some((block) => block.where.startsWith(`${guide}:`)),
        guide,
      ).toBe(true);
    }
  });

  it('shows a document that stops short only with a … in it', () => {
    const unmarked = recorded()
      .filter((block) => !isPartial(block) && documentOf(block).at(-1) !== '</html>')
      .map((block) => block.where);
    expect(unmarked).toEqual([]);
  });

  // Every response block that shows a content-length and a whole document,
  // whatever other headers it shows: a block that omits the policy line is
  // still a claim about bytes. A static file (the console shell) is served
  // with the newline its file ends in, which a fence cannot show.
  it('gives each complete document the content-length its bytes have', () => {
    const wrong = GUIDES.flatMap((guide) =>
      scanFences(loadSource(guide)).spans.flatMap((span) => {
        const header = span.body.find((line) => line.startsWith('content-length: '));
        const block = { where: `${guide}:${String(span.startLine)}`, lines: span.body };
        if (
          !(span.body[0] ?? '').startsWith('HTTP/1.1 ') ||
          header === undefined ||
          !span.body.includes('<!doctype html>') ||
          !span.body.includes('</html>') ||
          isPartial(block)
        ) {
          return [];
        }
        const document = documentOf(block).join('\n');
        const bytes = Buffer.byteLength(document);
        const served = document.includes('<main class="page">') ? [bytes] : [bytes, bytes + 1];
        return served.map((n) => `content-length: ${String(n)}`).includes(header)
          ? []
          : [`${block.where}: ${header}, ${String(bytes)} bytes`];
      }),
    );
    expect(wrong).toEqual([]);
  });

  it('wraps each complete document in the shell page() builds', () => {
    const drift = complete().flatMap((block) => {
      const text = documentOf(block).join('\n').replace(RELOAD_ON_RESTORE, '\n</body>');
      const titleEnd = text.indexOf(BETWEEN, BEFORE_TITLE.length);
      const ok =
        text.startsWith(BEFORE_TITLE) &&
        titleEnd !== -1 &&
        text.endsWith(AFTER_BODY) &&
        page(
          unescaped(text.slice(BEFORE_TITLE.length, titleEnd)),
          text.slice(titleEnd + BETWEEN.length, text.length - AFTER_BODY.length),
        ).html === text;
      return ok ? [] : [block.where];
    });
    expect(drift).toEqual([]);
  });
});

// The page's own markup, as recorded: what sits between the shell's mark and
// its closing `</main>`.
function bodyOf(block: Recorded): string {
  const text = documentOf(block).join('\n').replace(RELOAD_ON_RESTORE, '\n</body>');
  const titleEnd = text.indexOf(BETWEEN, BEFORE_TITLE.length);
  return text.slice(titleEnd + BETWEEN.length, text.length - AFTER_BODY.length);
}

const titleOf = (block: Recorded): string =>
  unescaped(/<title>([^<]*)<\/title>/u.exec(documentOf(block).join('\n'))?.[1] ?? '');
const first = (text: string, pattern: RegExp): string => unescaped(pattern.exec(text)?.[1] ?? '');
const all = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((m) => unescaped(m[1] ?? ''));

const RULES_DEFAULT: PasswordRules = {
  minLength: 15,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};

// The rule codes the domain reports, so a recorded violation is read back by
// asking the real page which rule renders as that sentence.
const RULES = [
  'min-length',
  'max-length',
  'require-digit',
  'require-uppercase',
  'require-lowercase',
  'require-special',
  'not-username',
  'not-email',
  'common-password',
  'not-reused',
  'superseded',
];

function violationFor(sentence: string): { rule: string; message: string; minLength?: number } {
  const minLength = Number(/at least (\d+) characters/u.exec(sentence)?.[1] ?? 0);
  for (const rule of RULES) {
    const candidate = { rule, message: 'x', minLength };
    const rendered = renderUpdatePasswordPage(
      't',
      pathAddress(ORIGIN, 't'),
      's',
      [candidate],
      RULES_DEFAULT,
      LOCALE,
    ).body;
    if (first(rendered, ENTRY) === sentence) return candidate;
  }
  return { rule: 'unknown', message: sentence };
}

const ACCOUNT_RULES = RULES.filter((rule) => rule !== 'superseded');
const REFUSALS: readonly RegistrationRefusal[] = [
  'email_taken',
  'username_taken',
  'invalid_email',
  'invalid_username',
];
const LINKED_ACTIONS = [
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
] as const;

// The account pages word a rule from its own catalogue, so a recorded
// sentence is read back by asking the account page which rule renders as it.
function accountViolationFor(sentence: string): {
  rule: string;
  message: string;
  minLength?: number;
} {
  const minLength = Number(/at least (\d+) characters/u.exec(sentence)?.[1] ?? 0);
  for (const rule of ACCOUNT_RULES) {
    const candidate = { rule, message: 'x', minLength };
    const rendered = renderResetPasswordForm(
      't',
      pathAddress(ORIGIN, 't'),
      'k',
      [candidate],
      RULES_DEFAULT,
      LOCALE,
    ).body;
    if (first(rendered, ENTRY) === sentence) return candidate;
  }
  return { rule: 'unknown', message: sentence };
}

// The rules a recorded password page tells the person, read from the list it
// shows: the minimum from the field and a line for each character rule.
const rulesOf = (body: string): PasswordRules => ({
  minLength: Number(/name="password"[^>]*minlength="(\d+)"/u.exec(body)?.[1] ?? 15),
  requireDigit: body.includes('data-rule="digit"'),
  requireUppercase: body.includes('data-rule="uppercase"'),
  requireLowercase: body.includes('data-rule="lowercase"'),
  requireSpecial: body.includes('data-rule="special"'),
});
// A page's script carries a nonce fresh for each response.
const unnonced = (text: string): string => text.replace(/nonce="[^"]*"/gu, 'nonce="N"');

const ORIGIN = 'https://idp.example';
const tenantOf = (body: string): string => first(body, /(?:action|href)="\/tenants\/([^/"]*)\//u);
const keyOf = (body: string): string => first(body, /name="key" value="([^"]*)"/u);
// An entry of a form's alert carries an id; a plain list item does not.
const ENTRY = /<li id="form-error-\d+">(.*)<\/li>/u;
const entriesOf = (body: string): string[] => all(body, /^<li id="form-error-\d+">(.*)<\/li>$/gmu);
const itemsOf = (body: string): string[] => all(body, /^<li>(.*)<\/li>$/gmu);
const refused = (body: string): boolean => body.includes('<div class="alert" role="alert"');
const valueOf = (body: string, name: string): string | undefined =>
  new RegExp(`name="${name}"[^>]*? value="([^"]*)"`, 'u').exec(body)?.[1] === undefined
    ? undefined
    : first(body, new RegExp(`name="${name}"[^>]*? value="([^"]*)"`, 'u'));
// The way back a recorded page links to, if it does.
const backOf = (body: string): string | null =>
  body.includes('>Back to sign in</a>')
    ? first(body, /<a href="([^"]*)">Back to sign in<\/a>/u)
    : null;
// The way on a finished link's page leads to, if it does.
const continueOf = (body: string): string | null =>
  body.includes('>Continue to sign in</a>')
    ? first(body, /<a href="([^"]*)">Continue to sign in<\/a>/u)
    : null;
const returnToOf = (body: string): string | null =>
  body.includes('name="return_to"') ? first(body, /name="return_to" value="([^"]*)"/u) : null;

// What a recorded form's alert says its refusal was, found by asking the real
// page which input renders as each recorded sentence.
function passwordFailureOf(body: string): PasswordFailure | undefined {
  if (!refused(body)) return undefined;
  const entries = entriesOf(body);
  return entries.length === 1 &&
    entries[0] ===
      first(
        renderResetPasswordForm(
          't',
          pathAddress(ORIGIN, 't'),
          'k',
          'required',
          RULES_DEFAULT,
          LOCALE,
        ).body,
        ENTRY,
      )
    ? 'required'
    : entries.map(accountViolationFor);
}

function registrationFailureOf(body: string): RegistrationFailure | undefined {
  if (!refused(body)) return undefined;
  const entries = entriesOf(body);
  const refusal = REFUSALS.find(
    (candidate) =>
      entriesOf(
        renderRegistrationForm(
          't',
          pathAddress(ORIGIN, 't'),
          { rules: RULES_DEFAULT, failure: { refusal: candidate } },
          LOCALE,
        ).body,
      )[0] === entries[0],
  );
  if (refusal !== undefined && entries.length === 1) return { refusal };
  if (/name="password_confirm"[^>]*aria-invalid/u.test(body) && entries.length === 1) {
    const mismatch = renderRegistrationForm(
      't',
      pathAddress(ORIGIN, 't'),
      { rules: RULES_DEFAULT, failure: { mismatch: true } },
      LOCALE,
    );
    if (entriesOf(mismatch.body)[0] === entries[0]) return { mismatch: true };
  }
  const missing = (
    [
      ['username', 'username'],
      ['email', 'email'],
      ['password', 'password'],
      ['password_confirm', 'passwordConfirm'],
    ] as const
  )
    .filter(([name]) => new RegExp(`name="${name}"[^>]*aria-invalid`, 'u').test(body))
    .map(([, field]) => field);
  const asked = renderRegistrationForm(
    't',
    pathAddress(ORIGIN, 't'),
    { rules: RULES_DEFAULT, failure: { missing } },
    LOCALE,
  );
  if (missing.length > 0 && entriesOf(asked.body).join() === entries.join()) return { missing };
  return { violations: entries.map(accountViolationFor) };
}
const actionsOf = (body: string): (typeof LINKED_ACTIONS)[number][] =>
  itemsOf(body).flatMap((text) => {
    const found = LINKED_ACTIONS.find(
      (action) =>
        first(
          renderRequiredActionsSucceededPage([action], null, null, LOCALE).body,
          /<li>(.*)<\/li>/u,
        ) === text,
    );
    return found === undefined ? [] : [found];
  });

// A recording shows the QR image as an elision, so the page is read back
// with the same one standing where the image is.
const QR_ELIDED = '<svg …>…</svg>';
const elidesOnlyTheQr = (block: Recorded): boolean =>
  documentOf(block)
    .filter((line) => line.includes('…'))
    .every((line) => line === QR_ELIDED);

// What the recorded markup says its inputs were, put back through the real
// renderer: a page whose text or markup the server no longer produces for the
// same inputs is named here. It cannot see a branch no recording takes, the
// login forms (too many inputs to read back), the passkey and pending-action
// pages of authn-flows (recorded nowhere), the account forms nothing records,
// a rule or action wording that two sentences share, or a value the markup
// does not show.
const RENDER_BACK: Record<string, (body: string) => string> = {
  'Set up your authenticator': (body: string) =>
    renderTotpEnrolmentPage(
      tenantOf(body),
      pathAddress(ORIGIN, tenantOf(body)),
      first(body, /name="auth_session_id" value="([^"]*)"/u),
      {
        secret: first(body, /name="secret" value="([^"]*)"/u),
        uri: first(body, /<p><bdi dir="ltr"><code>(otpauth:[^<]*)<\/code><\/bdi><\/p>/u),
      },
      refused(body) ? 'code_mismatch' : undefined,
      LOCALE,
    ).body.replace(/<svg version=[\s\S]*?<\/svg>/u, QR_ELIDED),
  'Save your recovery codes': (body: string) =>
    renderRecoveryCodesPage(
      tenantOf(body),
      pathAddress(ORIGIN, tenantOf(body)),
      first(body, /name="auth_session_id" value="([^"]*)"/u),
      {
        codes: all(body, /^ {2}<li><bdi dir="ltr"><code>(.*)<\/code><\/bdi><\/li>$/gmu),
        replaced: body.includes('<p>These replace the codes'),
      },
      refused(body) ? 'codes_not_saved' : undefined,
      LOCALE,
    ).body,
  'Change your password': (body: string) =>
    renderUpdatePasswordPage(
      tenantOf(body),
      pathAddress(ORIGIN, tenantOf(body)),
      first(body, /name="auth_session_id" value="([^"]*)"/u),
      entriesOf(body).map(violationFor),
      rulesOf(body),
      LOCALE,
    ).body,
  'Create account': (body) => {
    const username = valueOf(body, 'username');
    const email = valueOf(body, 'email');
    const failure = registrationFailureOf(body);
    return renderRegistrationForm(
      tenantOf(body),
      pathAddress(ORIGIN, tenantOf(body)),
      {
        rules: rulesOf(body),
        signInPath: returnToOf(body),
        ...(failure === undefined ? {} : { failure }),
        ...(username === undefined ? {} : { username }),
        ...(email === undefined ? {} : { email }),
      },
      LOCALE,
    ).body;
  },
  "Can't create this account": (body) =>
    renderRegistrationFailedPage(pathAddress(ORIGIN, tenantOf(body)), null, LOCALE).body,
  'Account created': () => renderRegistrationSucceededPage(false, null, LOCALE).body,
  'Email confirmed': (body) => renderVerificationSucceededPage(continueOf(body), null, LOCALE).body,
  "Can't verify this link": (body) => renderVerificationFailedPage(backOf(body), null, LOCALE).body,
  'Forgot your password?': (body) => {
    const email = valueOf(body, 'email');
    return renderResetRequestForm(
      tenantOf(body),
      pathAddress(ORIGIN, tenantOf(body)),
      {
        signInPath: returnToOf(body),
        emailRequired: refused(body),
        ...(email === undefined ? {} : { email }),
      },
      LOCALE,
    ).body;
  },
  'Check your email': (body) =>
    body.includes('we sent a link to finish')
      ? renderRegistrationSucceededPage(true, null, LOCALE).body
      : renderResetRequestedPage(null, LOCALE).body,
  'Confirm your email address': (body) =>
    renderEmailConfirmPage(
      pathAddress(ORIGIN, tenantOf(body)),
      keyOf(body),
      body.includes('Account name:') ? first(body, /Account name: <bdi>(.*)<\/bdi>/u) : null,
      LOCALE,
    ).body,
  'Your account is ready': (body) => renderRegistrationReadyPage(continueOf(body), LOCALE).body,
  "Can't send a reset link": (body) =>
    renderResetRequestFailedPage(pathAddress(ORIGIN, tenantOf(body)), null, LOCALE).body,
  'Choose a new password': (body) =>
    renderResetPasswordForm(
      tenantOf(body),
      pathAddress(ORIGIN, tenantOf(body)),
      keyOf(body),
      passwordFailureOf(body),
      rulesOf(body),
      LOCALE,
    ).body,
  'Password reset': (body) => renderResetPasswordSucceededPage(backOf(body), null, LOCALE).body,
  "Can't use this link": (body) =>
    renderResetLinkFailedPage(
      body.includes('>Request a new link</a>')
        ? first(body, /<a href="([^"]*)">Request a new link<\/a>/u)
        : null,
      backOf(body),
      null,
      LOCALE,
    ).body,
  'Update your account': (body) =>
    renderRequiredActionsForm(
      tenantOf(body),
      pathAddress(ORIGIN, tenantOf(body)),
      keyOf(body),
      actionsOf(body),
      body.includes('name="password"'),
      passwordFailureOf(body),
      rulesOf(body),
      LOCALE,
    ).body,
  'Account updated': (body) =>
    renderRequiredActionsSucceededPage(actionsOf(body), backOf(body), null, LOCALE).body,
  'Sign-in failed': () => renderSignInRefused(LOCALE).body,
  'Allow access?': (body) => {
    const link = (label: RegExp): string | null => {
      const href = /<a href="([^"]*)">/u;
      const found = new RegExp(`<a href="[^"]*">${label.source}</a>`, 'u').exec(body);
      return found === null ? null : first(found[0], href);
    };
    const optional = [
      ...body.matchAll(
        /<label><input type="checkbox" name="scope" value="([^"]*)"( checked)?> <bdi>([^<]*)<\/bdi>/gu,
      ),
    ];
    return renderConsentPage(
      {
        tenant: first(body, /action="\/tenants\/([^/"]*)\//u),
        address: pathAddress(ORIGIN, first(body, /action="\/tenants\/([^/"]*)\//u)),
        authSessionId: first(body, /name="auth_session_id" value="([^"]*)"/u),
        clientName: first(body, /<h1><bdi>(.*?)<\/bdi> is asking/u),
        clientPages: {
          clientUri: link(/About <bdi>.*?<\/bdi>/u),
          policyUri: link(/Privacy policy/u),
          tosUri: link(/Terms of service/u),
        },
        defaultScopes: all(body.slice(body.indexOf('<ul>')), /^ {2}<li><bdi>(.*)<\/bdi><\/li>$/gmu),
        optionalScopes: optional.map((m) => unescaped(m[1] ?? '')),
        alreadyGranted: optional
          .filter((m) => m[2] !== undefined)
          .map((m) => unescaped(m[1] ?? '')),
        scopeLabels: Object.fromEntries(
          optional.map((m) => [unescaped(m[1] ?? ''), unescaped(m[3] ?? '')]),
        ),
      },
      LOCALE,
    ).body;
  },
  'Choose an account': (body) =>
    renderSelectAccountPage(
      {
        tenant: first(body, /action="\/tenants\/([^/"]*)\//u),
        address: pathAddress(ORIGIN, first(body, /action="\/tenants\/([^/"]*)\//u)),
        authSessionId: first(body, /name="auth_session_id" value="([^"]*)"/u),
        accounts: [
          ...body.matchAll(/name="session_id" value="([^"]*)"[^>]*><bdi>(.*?)<\/bdi>/gu),
        ].map((m) => ({ sessionId: unescaped(m[1] ?? ''), displayName: unescaped(m[2] ?? '') })),
      },
      LOCALE,
    ).body,
  'Sign-in error': (body) => {
    const href = /<p><a href="([^"]*)">([^<]*)<\/a><\/p>/u.exec(body);
    const wayOn: WayOn | undefined =
      href === null
        ? undefined
        : {
            kind: href[2] === 'Start sign-in again' ? 'restart' : 'return',
            href: unescaped(href[1] ?? ''),
          };
    return renderAuthorizeErrorPage(
      first(body, /<small>(.*)<\/small>/u),
      first(body, /<p><bdi>(.*)<\/bdi><\/p>/u),
      wayOn,
      LOCALE,
    ).body;
  },
  'Sign out?': (body) =>
    renderLogoutConfirmationPage(
      pathAddress(ORIGIN, tenantOf(body)),
      first(body, /name="session_id" value="([^"]*)"/u),
      first(body, /name="csrf" value="([^"]*)"/u),
      {
        clientId: /name="client_id" value="([^"]*)"/u.test(body)
          ? first(body, /name="client_id" value="([^"]*)"/u)
          : null,
        postLogoutRedirectUri: body.includes('name="post_logout_redirect_uri"')
          ? first(body, /name="post_logout_redirect_uri" value="([^"]*)"/u)
          : null,
        state: body.includes('name="state"') ? first(body, /name="state" value="([^"]*)"/u) : null,
      },
      LOCALE,
    ).body,
  "Can't sign out": () => renderLogoutUnauthenticatedPage(LOCALE).body,
  'Already signed out': () => renderNoActiveSessionPage(LOCALE).body,
  'Too many attempts': (body) =>
    renderThrottledPage(Number(first(body, /Try again in (\d+) second/u)), LOCALE).body,
  'Signed out': (body) => {
    const frames = all(body, /<iframe src="([^"]*)"><\/iframe>/gu);
    return renderLoggedOutPage(frames, LOCALE).body;
  },
};

// Every complete document in the guides, with or without the response head
// above it.
function documents(): Recorded[] {
  return GUIDES.flatMap((guide) =>
    scanFences(loadSource(guide)).spans.flatMap((span) =>
      span.body.includes('<!doctype html>')
        ? [{ where: `${guide}:${String(span.startLine)}`, lines: span.body }]
        : [],
    ),
  ).filter((block) => !isPartial(block) || elidesOnlyTheQr(block));
}

describe('the pages the guides record are what the renderers produce for the same inputs', () => {
  it('covers a consent screen, so an empty scan cannot pass', () => {
    expect(documents().some((block) => titleOf(block) === 'Allow access?')).toBe(true);
  });

  it('renders each recorded body back to the same markup', () => {
    const drift = documents().flatMap((block) => {
      const render = RENDER_BACK[titleOf(block)];
      if (render === undefined) return [];
      const body = bodyOf(block);
      return unnonced(render(body)) === unnonced(body) ? [] : [block.where];
    });
    expect(drift).toEqual([]);
  });
});
