import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_WEIGHT,
  MAX_SUBJECT_LENGTH,
  checkCommitMessage,
} from '../../tools/commit-message/src/check.js';

const rules = (message: string): string[] => checkCommitMessage(message).map((v) => v.rule);

const body = (lines: number): string =>
  Array.from({ length: lines }, (_, i) => `line ${String(i)}`).join('\n');

describe('a commit message says what changed and why, briefly', () => {
  it('accepts a subject alone', () => {
    expect(rules('Reap expired state on a stated window')).toEqual([]);
  });

  it('accepts a subject and a body inside the budget', () => {
    expect(rules(`Reap expired state\n\n${body(MAX_BODY_WEIGHT)}`)).toEqual([]);
  });

  it('refuses a body past the budget', () => {
    expect(rules(`Reap expired state\n\n${body(MAX_BODY_WEIGHT + 1)}`)).toEqual(['body-too-long']);
  });

  // The budget is a reading cost, not a newline count: rewrapping the same
  // prose into fewer, longer lines has to cost the same.
  it('counts a line wider than the wrap as the lines it reads as', () => {
    expect(rules(`Reap expired state\n\n${'w'.repeat(72 * MAX_BODY_WEIGHT + 1)}`)).toEqual([
      'body-too-long',
    ]);
  });

  it('does not count blank lines against the budget', () => {
    const spaced = Array.from({ length: MAX_BODY_WEIGHT }, (_, i) => `line ${String(i)}`).join(
      '\n\n',
    );
    expect(rules(`Reap expired state\n\n${spaced}`)).toEqual([]);
  });

  it('refuses a subject past its length', () => {
    expect(rules('S'.repeat(MAX_SUBJECT_LENGTH + 1))).toEqual(['subject-too-long']);
  });

  it('requires a blank line between the subject and the body', () => {
    expect(rules('Reap expired state\nstraight into prose')).toEqual(['no-blank-after-subject']);
  });

  it('still refuses a tool-attribution trailer', () => {
    expect(rules('Reap expired state\n\nCo-Authored-By: Claude <noreply@anthropic.com>')).toEqual([
      'tool-attribution',
    ]);
    expect(rules('Reap expired state\n\n🤖 Generated with Claude Code')).toEqual([
      'tool-attribution',
    ]);
  });

  // Both are generated, and `git revert` writes the original's hash block.
  // Failing them would make a revert impossible without --no-verify.
  it('exempts merge and revert commits from the length rules', () => {
    expect(rules(`Merge pull request #11 from wizzywit/p2b\n\n${body(40)}`)).toEqual([]);
    expect(rules(`Revert "Reap expired state"\n\n${body(40)}`)).toEqual([]);
  });

  // A revert is exempt from length, not from everything.
  it('does not exempt a merge commit from the attribution rule', () => {
    expect(rules('Merge pull request #11\n\nCo-authored-by: Claude <x@anthropic.com>')).toEqual([
      'tool-attribution',
    ]);
  });

  // git hands the hook the whole COMMIT_EDITMSG: its own `#` guidance, and
  // under `commit --verbose` the diff below the scissors line. Counting
  // either would refuse every message written in an editor.
  it('ignores git comment lines and the verbose diff', () => {
    const message = [
      'Reap expired state',
      '',
      'One real line.',
      '# Please enter the commit message for your changes. Lines starting',
      '# with # will be ignored, and an empty message aborts the commit.',
      '# ------------------------ >8 ------------------------',
      ...Array.from({ length: 40 }, () => 'diff --git a/x b/x'),
    ].join('\n');
    expect(rules(message)).toEqual([]);
  });

  it('reports every rule a message breaks, not only the first', () => {
    const message = `${'S'.repeat(MAX_SUBJECT_LENGTH + 1)}\n\n${body(MAX_BODY_WEIGHT + 1)}`;
    expect(rules(message).sort()).toEqual(['body-too-long', 'subject-too-long']);
  });
});
