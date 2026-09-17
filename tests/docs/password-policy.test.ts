import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluatePassword,
  REUSED_PASSWORD,
} from '../../packages/domain-identity/src/service/password-policy.js';
import { loadDocument, REPO_ROOT } from './markdown.js';

const GUIDE = 'docs/request-paths.md';

// The registration page renders every refusal as one list, so its own
// non-policy reasons — a taken username, an address already registered —
// arrive as <li> lines beside the policy's. They are read out of the route
// that renders them rather than restated here, so a reworded one is still
// compared against what the server would say.
const REGISTRATION_ROUTE = 'packages/account/src/view/routes/registration.ts';

function registrationRefusals(): Set<string> {
  const source = readFileSync(path.join(REPO_ROOT, REGISTRATION_ROUTE), 'utf8');
  const messages = new Set(
    [...source.matchAll(/renderRegistrationFailedPage\(\['(?<message>[^']+)'\]\)/gu)].flatMap(
      (match) => (match.groups?.message === undefined ? [] : [match.groups.message]),
    ),
  );
  if (messages.size === 0) {
    throw new Error(
      `${REGISTRATION_ROUTE} no longer renders a refusal as a literal message; ` +
        'point this check at where those words went.',
    );
  }
  return messages;
}

// Every violation message the password policy can actually produce, for
// the policy shapes docs/request-paths.md's transcripts exercise: the
// default realm policy (min-length, not-username, not-email) and that same
// policy with digit/uppercase also required. REUSED_PASSWORD joins them
// because history is the one rule no candidate alone decides — it is
// verified against stored hashes where a transaction is in hand. A reworded
// message falls out of this set and fails the check below, rather than
// silently downgrading the transcript to a claim nobody re-ran.
function possibleMessages(): Set<string> {
  const base = {
    minLength: 8,
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

  const messages = new Set<string>();
  for (const violation of evaluatePassword('short', strict, subject)) {
    messages.add(violation.message);
  }
  for (const violation of evaluatePassword('myadapassword', base, subject)) {
    messages.add(violation.message);
  }
  messages.add(REUSED_PASSWORD.message);
  for (const refusal of registrationRefusals()) messages.add(refusal);
  return messages;
}

describe('the password-policy violation messages in docs/request-paths.md are ones the policy actually produces', () => {
  it('matches every <li> violation line to a real message', () => {
    const document = loadDocument(GUIDE);
    const possible = possibleMessages();
    // A policy violation is rendered as plain text in its <li>. The other
    // list this document shows inside a transcript is the recovery codes,
    // whose items are `<code>`-wrapped values rather than sentences; they
    // have their own check in recovery-codes.test.ts.
    const shown = document.lines
      .map((line, index) => ({ text: line.trim(), lineNumber: index + 1 }))
      .filter(({ text }) => /^<li>(?!<code>).*<\/li>$/u.test(text));

    if (shown.length === 0) {
      throw new Error(
        `${GUIDE} no longer shows a password-policy violation as an <li> — ` +
          'the transcripts this check reads moved or were replaced.',
      );
    }

    for (const { text, lineNumber } of shown) {
      const message = text.replace(/^<li>/u, '').replace(/<\/li>$/u, '');
      expect(
        possible.has(message),
        `${GUIDE}:${String(lineNumber)} shows a violation message the password policy ` +
          `does not produce: ${JSON.stringify(message)}`,
      ).toBe(true);
    }
  });
});
