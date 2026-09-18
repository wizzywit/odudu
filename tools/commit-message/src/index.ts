import { readFile } from 'node:fs/promises';
import { checkCommitMessage } from '#/check';

// One authority for the rules, called from two places: `.githooks/commit-msg`
// for a commit made here, and the `commit-messages` job in verify.yml for a
// clone that never installed the hook. The rules were written twice before
// this, once in each, with a comment in each saying the other existed.
const [, , first, second] = process.argv;
// `--stored` says the file holds a message read back with `git log
// --format=%B` rather than an editor buffer, which decides whether a `#`
// line is git's guidance or somebody's body text.
const stored = first === '--stored';
const path = stored ? second : first;

if (path === undefined) {
  process.stderr.write('usage: odudu-commit-message [--stored] <message-file>\n');
  process.exit(2);
}

const violations = checkCommitMessage(await readFile(path, 'utf8'), stored ? 'stored' : 'editor');

if (violations.length > 0) {
  process.stderr.write('\nCommit rejected:\n\n');
  for (const violation of violations) {
    process.stderr.write(`  ${violation.rule}: ${violation.detail}\n`);
  }
  process.stderr.write(
    '\nA commit message says what changed and why, briefly. Reasoning that does\n' +
      'not fit belongs in an ADR or a phase spec, where a reader can find it.\n',
  );
  process.exit(1);
}
