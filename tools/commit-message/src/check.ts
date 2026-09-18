// A commit message says what changed and why. The reasoning behind it goes
// to an ADR or a phase spec, which this project already requires and which a
// reader can find six months later; a message long enough to hold that
// reasoning hides the summary it was written to give. Measured across the
// first 359 commits, half the bodies were already 10 lines or fewer and the
// longest was 59 — so this is a ceiling on the tail, not a new practice.
export const MAX_BODY_WEIGHT = 8;

// Git's own convention, and what `git log --oneline` and every forge's list
// view truncate near.
export const MAX_SUBJECT_LENGTH = 72;

// Git wraps a body at 72 and indents it by four. A line wider than this is
// one line on disk and more than one line of reading, so it is weighted as
// the lines it reads as: the budget cannot be met by rewrapping the same
// prose into fewer, longer lines. `tests/lint/comment-block-length.test.ts`
// weights a comment block the same way and for the same reason.
const BODY_WRAP = 72;

// A merge's body is the forge's, and `git revert` writes the reverted
// commit's hash block. Neither is written by the person committing, so the
// length rules have nothing to hold them to. The exemption earns its place
// in CI rather than in the hook: `git revert` runs `git commit -n` through
// the sequencer and so never reaches a commit-msg hook at all, while CI
// reads every commit a branch adds.
const GENERATED_SUBJECT = /^(Merge|Revert)\b/u;

// Only generated attribution, and not only one vendor's: the rule is that a
// commit message carries no tool attribution, so a trailer naming any of
// them breaks it. A human co-author is fine, and so is prose about a tool
// that generated something other than this commit — which is why the
// generic verb is not matched on its own.
const GENERATORS =
  'claude|anthropic|copilot|chatgpt|openai|gpt-[0-9]|gemini|cursor|codeium|devin|codex';
const TOOL_ATTRIBUTION = new RegExp(
  `co-authored-by:.*(${GENERATORS})|generated with .*(${GENERATORS})|🤖`,
  'iu',
);

// `git commit --verbose` appends the diff below this marker.
const SCISSORS = /^#\s*-+\s*>8\s*-+/u;

export interface Violation {
  readonly rule:
    'tool-attribution' | 'subject-too-long' | 'no-blank-after-subject' | 'body-too-long';
  readonly detail: string;
}

function weigh(line: string): number {
  return Math.max(1, Math.ceil(line.length / BODY_WRAP));
}

/**
 * Where the message came from. An editor buffer carries git's own `#`
 * guidance and, under --verbose, the whole diff; a stored message read back
 * with `git log --format=%B` carries neither, and a `#` line in one is body
 * text that `--cleanup=verbatim` kept. Stripping it there would let an
 * over-long body through the budget, so the filtering is bound to the
 * source rather than applied to everything.
 */
export type MessageSource = 'editor' | 'stored';

export function messageLines(message: string, source: MessageSource): string[] {
  if (source === 'stored') return message.split('\n');
  const lines: string[] = [];
  for (const line of message.split('\n')) {
    if (SCISSORS.test(line)) break;
    if (line.startsWith('#')) continue;
    lines.push(line);
  }
  return lines;
}

export function checkCommitMessage(message: string, source: MessageSource): Violation[] {
  const lines = messageLines(message, source);
  const subject = lines[0] ?? '';
  const violations: Violation[] = [];

  if (TOOL_ATTRIBUTION.test(lines.join('\n'))) {
    violations.push({
      rule: 'tool-attribution',
      detail: 'the message carries a tool-attribution trailer',
    });
  }

  if (GENERATED_SUBJECT.test(subject)) return violations;

  if (subject.length > MAX_SUBJECT_LENGTH) {
    violations.push({
      rule: 'subject-too-long',
      detail: `the subject is ${String(subject.length)} characters; the limit is ${String(MAX_SUBJECT_LENGTH)}`,
    });
  }

  if (lines.length > 1 && lines[1] !== '') {
    violations.push({
      rule: 'no-blank-after-subject',
      detail: 'a body starts on the line after the subject, with no blank line between them',
    });
  }

  const weight = lines
    .slice(1)
    .filter((line) => line.trim() !== '')
    .reduce((total, line) => total + weigh(line), 0);

  if (weight > MAX_BODY_WEIGHT) {
    violations.push({
      rule: 'body-too-long',
      detail:
        `the body reads as ${String(weight)} lines; the limit is ${String(MAX_BODY_WEIGHT)}. ` +
        'Reasoning that does not fit belongs in an ADR or a phase spec',
    });
  }

  return violations;
}
