import {
  BREACH_CHECK_UNAVAILABLE,
  BREACHED_PASSWORD,
  evaluatePassword,
  REUSED_PASSWORD,
} from '@odudu/domain-identity';
import { DEFAULT_PAGE_LOCALE, PASSWORD_TOO_LONG, pageHeaders, pathAddress } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { type PasswordViolation } from '#/schema/password-violation';
import { en } from '#/view/messages';
import {
  renderRequestedUpdatePasswordPage,
  renderUpdatePasswordPage,
} from '#/view/update-password-html';
import { ar } from '#/view/messages.ar';
import { ARABIC, FRENCH } from '@odudu/testkit/i18n';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'updatePassword.title': 'Changez votre mot de passe',
    'updatePassword.rule.minLength':
      'Le mot de passe doit comporter au moins {min, number, ::group-off} caractères.',
    'updatePassword.rule.maxLength':
      'Le mot de passe ne doit pas dépasser {max, number, ::group-off} caractères.',
    'updatePassword.rule.requireDigit': 'Le mot de passe doit contenir un chiffre.',
    'updatePassword.rule.notReused': 'Le mot de passe ne doit pas avoir déjà servi.',
  });
});

// The page's script carries a nonce fresh for each response.
const withoutScript = (body: string): string =>
  body.replace(/<script nonce="[^"]*">[\s\S]*?<\/script>/u, '<script nonce="N">…</script>');

const POLICY_RULES = {
  minLength: 15,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};

const RULES: readonly PasswordViolation[] = [
  { rule: 'min-length', message: 'dev', minLength: 12 },
  { rule: 'max-length', message: 'dev' },
  { rule: 'require-digit', message: 'dev' },
  { rule: 'require-uppercase', message: 'dev' },
  { rule: 'require-lowercase', message: 'dev' },
  { rule: 'require-special', message: 'dev' },
  { rule: 'not-username', message: 'dev' },
  { rule: 'not-email', message: 'dev' },
  { rule: 'common-password', message: 'dev' },
  { rule: 'not-reused', message: 'dev' },
  { rule: 'superseded', message: 'dev' },
];

// Every rule code the domain can report must have a catalogue entry here, or
// the page falls back to the developer sentence for it.
describe('every rule the domain reports is worded by the catalogue', () => {
  const policy = {
    minLength: 300,
    tenantName: 'demo',
    requireDigit: true,
    requireUppercase: true,
    requireLowercase: true,
    requireSpecial: true,
    notUsername: true,
    notEmail: true,
    historyDepth: 1,
    maxAgeDays: 0,
  };
  const subject = { username: 'a', email: 'a@example.com' };

  it('carries the light or dark choice its locale holds into the document', () => {
    const dark = renderUpdatePasswordPage(
      'demo',
      pathAddress('https://idp.example', 'demo'),
      'sess-1',
      undefined,
      POLICY_RULES,
      {
        ...DEFAULT_PAGE_LOCALE,
        theme: 'dark',
      },
    );
    expect(dark.html).toContain('<html lang="en" dir="ltr" data-theme="dark">');
    const none = renderUpdatePasswordPage(
      'demo',
      pathAddress('https://idp.example', 'demo'),
      'sess-1',
      undefined,
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(none.html).not.toContain('data-theme');
  });

  it('renders each reported rule without the developer fallback', () => {
    const reported = [
      ...evaluatePassword('a'.repeat(400), policy, subject),
      ...evaluatePassword('A'.repeat(400), policy, subject),
      ...evaluatePassword('a', policy, subject),
      ...evaluatePassword('baseball', policy, subject),
      REUSED_PASSWORD,
      PASSWORD_TOO_LONG,
      BREACHED_PASSWORD,
      BREACH_CHECK_UNAVAILABLE,
    ];
    expect([...new Set(reported.map((violation) => violation.rule))].sort()).toEqual([
      'breach-check-unavailable',
      'breached-password',
      'common-password',
      'max-length',
      'min-length',
      'not-email',
      'not-reused',
      'not-username',
      'require-digit',
      'require-lowercase',
      'require-special',
      'require-uppercase',
    ]);
    for (const { rule, message } of reported) {
      const { body } = renderUpdatePasswordPage(
        'd',
        pathAddress('https://idp.example', 'd'),
        's',
        [{ rule, message, minLength: policy.minLength }],
        POLICY_RULES,
        DEFAULT_PAGE_LOCALE,
      );
      // The intro isolates the tenant; only a developer fallback would add another.
      expect(body.replace(/<header[\s\S]*?<\/header>/u, ''), rule).not.toContain('<bdi>');
    }
  });
});

describe('renderUpdatePasswordPage', () => {
  it('posts the new password to the update-password action with the session it was given', () => {
    const rendered = renderUpdatePasswordPage(
      'demo',
      pathAddress('https://idp.example', 'demo'),
      'sess-1',
      undefined,
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(rendered.html).toContain(
      'action="/tenants/demo/login-actions/required-action?action=update-password"',
    );
    expect(rendered.html).toContain('name="auth_session_id" value="sess-1"');
    expect(rendered.html).toContain('autocomplete="new-password"');
    expect(rendered.title).toBe('Change your password');
    expect(rendered.script?.fetchesSameOrigin).toBe(false);
    expect(rendered.html).toContain(`<script nonce="${rendered.script?.nonce ?? ''}">`);
  });

  it('keeps the English markup exactly', () => {
    expect(
      withoutScript(
        renderUpdatePasswordPage(
          'acme',
          pathAddress('https://idp.example', 'acme'),
          'sess-1',
          [
            { rule: 'min-length', message: 'dev', minLength: 12 },
            { rule: 'require-digit', message: 'dev' },
          ],
          POLICY_RULES,
          DEFAULT_PAGE_LOCALE,
        ).body,
      ),
    ).toBe(`<header class="intro">
<h1>Change your password</h1>
<p class="tenant"><bdi>acme</bdi></p>
</header>
<p>This account needs a new password before you can continue.</p>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must be at least 12 characters long.</li>
<li id="form-error-1">Password must contain a digit.</li>
</ul>
</div>
<form method="post" action="/tenants/acme/login-actions/required-action?action=update-password">
  <input type="hidden" name="auth_session_id" value="sess-1">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 form-error-1 password-rules-list" autofocus></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="N">…</script>
  <label><input type="checkbox" name="end_other_sessions" id="end-other-sessions" value="true" checked> End my other sessions</label>
  <button type="submit">Update password</button>
</form>`);
  });

  it('offers to end the other sessions, checked, on both variants', () => {
    for (const render of [renderUpdatePasswordPage, renderRequestedUpdatePasswordPage]) {
      const { body } = render(
        'demo',
        pathAddress('https://idp.example', 'demo'),
        'sess-1',
        undefined,
        POLICY_RULES,
        DEFAULT_PAGE_LOCALE,
      );
      expect(body).toContain(
        '<input type="checkbox" name="end_other_sessions" id="end-other-sessions" value="true" checked> End my other sessions',
      );
    }
  });

  it('has an Arabic twin for the offer', () => {
    expect(ar['updatePassword.endOtherSessions']).toBeTruthy();
    expect(ar['updatePassword.endOtherSessions']).not.toBe(en['updatePassword.endOtherSessions']);
  });

  it('lists no violations when there are none', () => {
    expect(
      renderUpdatePasswordPage(
        'demo',
        pathAddress('https://idp.example', 'demo'),
        's',
        undefined,
        POLICY_RULES,
        DEFAULT_PAGE_LOCALE,
      ).html,
    ).not.toContain('<ul>');
  });

  it('reads every rule from the catalogue by its code, with its numbers', () => {
    const { body } = renderUpdatePasswordPage(
      'demo',
      pathAddress('https://idp.example', 'demo'),
      's',
      RULES,
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain('>Password must be at least 12 characters long.</li>');
    expect(body).toContain('>Password must be at most 256 characters long.</li>');
    expect(body).toContain(`>${en['updatePassword.rule.notReused']}</li>`);
    expect(body).toContain(`>${en['updatePassword.rule.superseded']}</li>`);
    expect(body).not.toContain('dev');
  });

  it('writes a long minimum without a thousands separator', () => {
    expect(
      renderUpdatePasswordPage(
        'd',
        pathAddress('https://idp.example', 'd'),
        's',
        [{ rule: 'min-length', message: 'x', minLength: 1000 }],
        POLICY_RULES,
        FRENCH,
      ).body,
    ).toContain('au moins 1000 caractères');
  });

  it('never states a minimum it was not given', () => {
    const { body } = renderUpdatePasswordPage(
      'demo',
      pathAddress('https://idp.example', 'demo'),
      's',
      [{ rule: 'min-length', message: 'Too short' }],
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain('<li id="form-error-0"><bdi>Too short</bdi></li>');
    expect(body).not.toContain('at least 0');
  });

  it('shows an unknown rule by its developer message, isolated', () => {
    const { body } = renderUpdatePasswordPage(
      'demo',
      pathAddress('https://idp.example', 'demo'),
      's',
      [{ rule: 'future-rule', message: 'Must be <b>blue</b>' }],
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain('><bdi>Must be &lt;b&gt;blue&lt;/b&gt;</bdi></li>');
    expect(body).not.toContain('<b>');
  });

  it('does not mistake a rule named like an object member for a catalogue entry', () => {
    const { body } = renderUpdatePasswordPage(
      'demo',
      pathAddress('https://idp.example', 'demo'),
      's',
      [{ rule: 'constructor', message: 'dev' }],
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain('><bdi>dev</bdi></li>');
  });

  it('renders each rule it has in French, and English for the keys the fixture lacks', () => {
    const page = renderUpdatePasswordPage(
      'demo',
      pathAddress('https://idp.example', 'demo'),
      's',
      RULES,
      POLICY_RULES,
      FRENCH,
    );
    expect(page.title).toBe('Changez votre mot de passe');
    expect(page.html).toContain('<html lang="fr" dir="ltr">');
    expect(page.body).toContain('>Le mot de passe doit comporter au moins 12 caractères.</li>');
    expect(page.body).toContain('>Le mot de passe ne doit pas dépasser 256 caractères.</li>');
    expect(page.body).toContain('>Le mot de passe doit contenir un chiffre.</li>');
    expect(page.body).toContain('>Le mot de passe ne doit pas avoir déjà servi.</li>');
    expect(page.body).toContain(`>${en['updatePassword.rule.requireUppercase']}</li>`);
    expect(page.body).toContain(`<h1>Changez votre mot de passe</h1>`);
  });

  it('writes lang and dir for a right-to-left locale', () => {
    expect(
      renderUpdatePasswordPage(
        'demo',
        pathAddress('https://idp.example', 'demo'),
        's',
        [],
        POLICY_RULES,
        ARABIC,
      ).html,
    ).toContain('<html lang="ar" dir="rtl">');
  });

  it('escapes the tenant, the session and each unknown-rule message', () => {
    const { html } = renderUpdatePasswordPage(
      '<b>t</b>',
      pathAddress('https://idp.example', '<b>t</b>'),
      '"><i>',
      [{ rule: 'x', message: '<img src=x onerror=1>' }],
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(html).not.toContain('<b>t</b>');
    expect(html).not.toContain('"><i>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('<bdi>&lt;img src=x onerror=1&gt;</bdi>');
  });
});

describe('renderUpdatePasswordPage with an unusual tenant name', () => {
  it('writes the name into the action as a path segment', () => {
    expect(
      renderUpdatePasswordPage(
        'a b"%',
        pathAddress('https://idp.example', 'a b"%'),
        's',
        [],
        POLICY_RULES,
        DEFAULT_PAGE_LOCALE,
      ).html,
    ).toContain(
      'action="/tenants/a%20b%22%25/login-actions/required-action?action=update-password"',
    );
  });
});

// What a screen reader is given: one alert, entry ids that are unique, and
// every field's description pointing at an entry that is there.
function expectCoherent(body: string): void {
  expect(body.match(/role="alert"/gu)?.length).toBe(1);
  const ids = [...body.matchAll(/ id="([^"]+)"/gu)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  const described = [...body.matchAll(/aria-describedby="([^"]+)"/gu)].flatMap((match) =>
    (match[1] ?? '').split(' '),
  );
  expect(described.length).toBeGreaterThan(0);
  for (const id of described) expect(ids, id).toContain(id);
}

describe('a refused change-password page reads coherently to a screen reader', () => {
  it('has one alert, unique ids and every description present', () => {
    expectCoherent(
      renderUpdatePasswordPage(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        's',
        [
          { rule: 'min-length', message: 'x', minLength: 12 },
          { rule: 'require-digit', message: 'x' },
        ],
        POLICY_RULES,
        DEFAULT_PAGE_LOCALE,
      ).body,
    );
  });
});

describe('the password hints on the change-password page', () => {
  const ALL = {
    minLength: 20,
    requireDigit: true,
    requireUppercase: true,
    requireLowercase: true,
    requireSpecial: true,
  };

  it('lists the tenant length and every rule it enables, as plain markup', () => {
    const { body } = renderUpdatePasswordPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      's',
      [],
      ALL,
      DEFAULT_PAGE_LOCALE,
    );
    expect([...body.matchAll(/<li[^>]*>([^<]*)<\/li>/gu)].map((match) => match[1])).toEqual([
      'At least 20 characters',
      'A digit',
      'An uppercase letter',
      'A lowercase letter',
      'A special character',
      'Not a common password',
    ]);
    expect(body).toContain('minlength="20"');
    expect(body).toContain('autocomplete="new-password"');
  });

  it('lists no character rule the tenant has not enabled', () => {
    const { body } = renderUpdatePasswordPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      's',
      [],
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(withoutScript(body)).not.toMatch(/digit|uppercase|lowercase|special character/iu);
  });

  it('points the field at its rules, after any message about it', () => {
    const { body } = renderUpdatePasswordPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      's',
      [{ rule: 'common-password', message: 'dev' }],
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(body).toContain('aria-describedby="form-error-0 password-rules-list"');
  });

  it('sends a policy that names the one script it carries, and no request', () => {
    const page = renderUpdatePasswordPage(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      's',
      [],
      POLICY_RULES,
      DEFAULT_PAGE_LOCALE,
    );
    const nonce = page.script?.nonce ?? '';
    const policy = pageHeaders(page).find(([name]) => name === 'content-security-policy')?.[1];
    expect(policy).toContain(`script-src 'nonce-${nonce}'`);
    expect(policy).not.toContain('connect-src');
    expect(page.html.match(/<script/gu)).toHaveLength(1);
  });
});
