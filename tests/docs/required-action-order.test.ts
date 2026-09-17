import { describe, expect, it } from 'vitest';
import { nextRequiredAction } from '../../packages/authn-flows/src/usecase/required-actions.js';
import { loadDocument } from './markdown.js';

// The order a login's pending actions run in is now stated in three places:
// REQUIRED_ACTION_ORDER, and a sentence in each of these documents. Three
// independent statements of one sequence is how a sequence drifts, and the
// order carries a security property — the password change comes first so an
// expired password can never be used to enrol a second factor — so a
// document that has fallen behind it is worse than one that never said.
const DOCUMENTS = ['README.md', 'docs/request-paths.md'] as const;

const ACTIONS = [
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
] as const;

// Derived by asking the resolver, not read off the constant: what a
// document is claiming is the order submissions are actually judged in, and
// a constant reordered without nextRequiredAction noticing would still be
// wrong. Owing everything and taking the head repeatedly is the only
// sequence a login can ever walk.
function orderTheResolverApplies(): string[] {
  const owed = new Set<string>(ACTIONS);
  const sequence: string[] = [];
  while (owed.size > 0) {
    const next = nextRequiredAction([...owed] as (typeof ACTIONS)[number][]);
    if (next === null) {
      throw new Error(
        `nextRequiredAction reports nothing owed while ${[...owed].join(', ')} still is. ` +
          'Either an action is missing from ACTIONS here, or the resolver no longer names it.',
      );
    }
    sequence.push(next);
    owed.delete(next);
  }
  return sequence;
}

// One sentence, from "in the order" to the end of the list, wherever it has
// been rewrapped to. Throws rather than matching nothing: a check that
// silently finds no claim passes forever.
function orderStatedIn(name: string): string[] {
  const text = loadDocument(name).lines.join(' ');
  const stated = /in the order (?<list>(?:`[a-z-]+`(?:,\s*)?)+)/u.exec(text);
  if (stated?.groups?.list === undefined) {
    throw new Error(
      `${name} no longer states the required-action order ("in the order \`…\`, \`…\`"). ` +
        'It moved or was reworded; point this check at where it went, or delete the claim.',
    );
  }
  return [...stated.groups.list.matchAll(/`(?<action>[a-z-]+)`/gu)].map(
    (match) => match.groups?.action ?? '',
  );
}

describe('the required-action order the documents state is the one submissions are judged in', () => {
  it('covers every action the resolver orders', () => {
    expect(orderTheResolverApplies()).toHaveLength(ACTIONS.length);
  });

  it.each(DOCUMENTS)('%s states it, and states it in full', (name) => {
    expect(`${name}: ${orderStatedIn(name).join(' → ')}`).toBe(
      `${name}: ${orderTheResolverApplies().join(' → ')}`,
    );
  });
});
