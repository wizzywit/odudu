import { describe, expect, it } from 'vitest';
import {
  evaluatePassword,
  REUSED_PASSWORD,
} from '../../packages/domain-identity/src/service/password-policy.js';
import {
  DEFAULT_PAGE_LOCALE,
  PASSWORD_TOO_LONG,
  pathAddress,
} from '../../packages/kernel/src/index.js';
import {
  renderRegistrationForm,
  type RegistrationRefusal,
} from '../../packages/account/src/view/registration-html.js';
import { renderResetPasswordForm } from '../../packages/account/src/view/reset-html.js';
import { at, loadSource, PROTOCOL_PAGES } from './markdown.js';

const GUIDE = PROTOCOL_PAGES;

const RULES = {
  minLength: 15,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};

const REFUSALS: readonly RegistrationRefusal[] = [
  'email_taken',
  'username_taken',
  'invalid_email',
  'invalid_username',
];

// The text of each entry in a form's alert, as served.
function itemsOf(body: string): string[] {
  return [...body.matchAll(/^<li id="form-error-\d+">(.*)<\/li>$/gmu)].map(
    (match) => match[1] ?? '',
  );
}

// Every <li> sentence the pages that list a refusal can show, read from the
// real renderers: each rule code the policy can report for the shapes the
// transcripts exercise (REUSED_PASSWORD joins them, history being the one
// rule no candidate alone decides) and each non-policy reason registration
// gives. A renamed code or reworded sentence falls out and fails the check
// below instead of downgrading the transcript to a claim nobody re-ran.
function possibleMessages(): Set<string> {
  const base = {
    tenantName: 'acme',
    minLength: 15,
    requireDigit: false,
    requireUppercase: false,
    requireLowercase: false,
    requireSpecial: false,
    notUsername: true,
    notEmail: true,
    historyDepth: 0,
    maxAgeDays: 0,
  };
  const strict = { ...base, requireDigit: true, requireUppercase: true };
  const subject = { username: 'ada', email: 'ada@example.com' };

  const reported = [
    ...evaluatePassword('short', strict, subject),
    ...evaluatePassword('myadapassword', base, subject),
    ...evaluatePassword('password', base, subject),
    REUSED_PASSWORD,
    PASSWORD_TOO_LONG,
  ].map(({ rule, message }) => ({
    rule,
    message,
    ...(rule === 'min-length' ? { minLength: base.minLength } : {}),
  }));
  const messages = new Set<string>();
  for (const violation of reported) {
    for (const item of itemsOf(
      renderResetPasswordForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        'key',
        [violation],
        RULES,
        DEFAULT_PAGE_LOCALE,
      ).body,
    )) {
      expect(item, `no catalogue sentence for the rule ${violation.rule}`).not.toContain('<bdi>');
      messages.add(item);
    }
  }
  for (const failure of [
    ...REFUSALS.map((refusal) => ({ refusal })),
    { missing: ['username', 'email', 'password'] as const },
  ]) {
    for (const item of itemsOf(
      renderRegistrationForm(
        'acme',
        pathAddress('https://idp.example', 'acme'),
        { rules: RULES, failure },
        DEFAULT_PAGE_LOCALE,
      ).body,
    )) {
      messages.add(item);
    }
  }
  return messages;
}

// The headings of the forms that render a violation list, as served.
function violationPageHeadings(): Set<string> {
  const headings = new Set<string>();
  for (const body of [
    renderRegistrationForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      { rules: RULES },
      DEFAULT_PAGE_LOCALE,
    ).body,
    renderResetPasswordForm(
      'acme',
      pathAddress('https://idp.example', 'acme'),
      'key',
      undefined,
      RULES,
      DEFAULT_PAGE_LOCALE,
    ).body,
  ]) {
    const title = /<h1>(?<title>[^<]+)<\/h1>/u.exec(body)?.groups?.title;
    if (title !== undefined) headings.add(title);
  }
  return headings;
}

describe('the password-policy violation messages in the protocol pages are ones the policy actually produces', () => {
  it('matches every <li> violation line to a real message', () => {
    const document = loadSource(GUIDE);
    const possible = possibleMessages();
    // A policy violation is rendered as plain text in its <li>. The other
    // list this document shows inside a transcript is the recovery codes,
    // whose items are `<code>`-wrapped values rather than sentences; they
    // have their own check in recovery-codes.test.ts.
    const headings = violationPageHeadings();
    let underViolationHeading = false;
    const shown = document.lines.flatMap((line, index) => {
      const text = line.trim();
      const heading = /^<h1>(?<title>.*)<\/h1>$/u.exec(text)?.groups?.title;
      if (heading !== undefined) underViolationHeading = headings.has(heading);
      if (!underViolationHeading) return [];
      return /^<li id="form-error-\d+">.*<\/li>$/u.test(text)
        ? [{ text, lineNumber: index + 1 }]
        : [];
    });

    if (shown.length === 0) {
      throw new Error(
        `${GUIDE} no longer shows a password-policy violation as an <li> — ` +
          'the transcripts this check reads moved or were replaced.',
      );
    }

    for (const { text, lineNumber } of shown) {
      const message = text.replace(/^<li id="form-error-\d+">/u, '').replace(/<\/li>$/u, '');
      expect(
        possible.has(message),
        `${at(document, lineNumber)} shows a violation message the password policy ` +
          `does not produce: ${JSON.stringify(message)}`,
      ).toBe(true);
    }
  });
});
