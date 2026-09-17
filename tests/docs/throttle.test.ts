import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../packages/kernel/src/config.js';
import { MAX_PASSWORD_LENGTH } from '../../packages/kernel/src/password-field.js';
import { loadDocument } from './markdown.js';

// Both documents quote the throttle's budget and the password maximum as
// numbers a reader will configure and test against. All three live in one
// schema default or one constant, neither of which is where anybody would
// think to look after rewording a paragraph.
const DOCUMENTS = ['README.md', 'docs/request-paths.md'] as const;

const defaults = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 1).toString('base64'),
});

function statedDefault(name: string, variable: string): string {
  const text = loadDocument(name).lines.join('\n');
  const stated = new RegExp(`\`${variable}\`[^\`]*\\(default \`(?<value>[0-9]+)\`\\)`, 'su').exec(
    text,
  );
  if (stated?.groups?.value === undefined) {
    throw new Error(`${name} no longer states a default for ${variable}`);
  }
  return stated.groups.value;
}

describe('the throttle numbers the documents state are the numbers the code uses', () => {
  it.each(DOCUMENTS)('%s states the budget the config schema defaults to', (name) => {
    expect(statedDefault(name, 'ODUDU_THROTTLE_LIMIT')).toBe(String(defaults.ODUDU_THROTTLE_LIMIT));
    expect(statedDefault(name, 'ODUDU_THROTTLE_WINDOW_SECONDS')).toBe(
      String(defaults.ODUDU_THROTTLE_WINDOW_SECONDS),
    );
  });

  // Every number this file finds next to "character", against the one
  // constant that decides it: a reworded sentence keeping a stale number
  // is the drift, and it fails here rather than passing on a match found
  // somewhere else in the file.
  it.each(DOCUMENTS)('%s states no password maximum other than the enforced one', (name) => {
    const text = loadDocument(name).lines.join('\n');
    const phrase =
      /(?:capped at|at most|over|longer than)\s+\*{0,2}(?<bound>[0-9]+)\s+characters?|(?<attributive>[0-9]+)-character maximum/gu;
    const stated = [...text.matchAll(phrase)].map(
      (match) => match.groups?.bound ?? match.groups?.attributive,
    );
    if (stated.length === 0) {
      throw new Error(`${name} no longer states the maximum password length`);
    }
    expect([...new Set(stated)]).toEqual([String(MAX_PASSWORD_LENGTH)]);
  });

  // The transcript is the claim most easily falsified by a changed default:
  // it shows the budget being spent request by request.
  it('shows exactly one budget spent before the 429 in docs/request-paths.md', () => {
    const lines = loadDocument('docs/request-paths.md').lines;
    const refusal = lines.findIndex(
      (line) => line.trim() === '--- the eleventh, from the same address ---',
    );
    if (refusal === -1) {
      throw new Error('docs/request-paths.md no longer shows the throttle transcript');
    }
    const allowed = lines
      .slice(0, refusal)
      .filter((line) => /^request [0-9]+: 200$/u.test(line)).length;

    expect(allowed).toBe(defaults.ODUDU_THROTTLE_LIMIT);
    expect(lines[refusal + 1]).toContain('429');
  });
});
