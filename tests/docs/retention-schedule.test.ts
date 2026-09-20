import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../packages/kernel/src/config.js';
import { LOGOUT_SENDER_JITTER_FRACTION } from '../../apps/server/src/modules/logout-sender.js';
import { OUTBOX_JITTER_FRACTION } from '../../apps/server/src/modules/outbox.js';
import { REAP_JITTER_FRACTION } from '../../apps/server/src/modules/reap.js';
import { loadDocument, REPO_ROOT } from './markdown.js';

// README.md and docs/request-paths.md both quote the interval the server
// reaps on and the warning it logs when it will not reap at all. The
// interval is a schema default and the warning is a string in one module;
// neither is where anybody would look after rewording a paragraph.
const DOCUMENTS = ['README.md', 'docs/request-paths.md'] as const;

const defaults = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 1).toString('base64'),
});

function textOf(name: string): string {
  return loadDocument(name).lines.join('\n');
}

// Whitespace flattened, and the concatenation Prettier introduces when a
// message outgrows one line joined back up, so a quoted sentence is
// searched for as the reader sees it rather than as the formatter left it.
function sourceText(source: string): string {
  return source.replaceAll(/'\s*\+\s*'/gu, '').replaceAll(/\s+/gu, ' ');
}

// A refusal reaches docs/request-paths.md two ways: quoted inline in a
// sentence, or as the captured output of the command that prints it. The
// second is the stronger evidence and carries no backticks, so both spellings
// are accepted — what is compared is still the document's wording against
// the source's.
function refusalQuoted(document: string, opening: string): string {
  const inline = new RegExp('`(?<message>' + opening + '[^`]+)`', 'su').exec(document);
  if (inline?.groups?.message !== undefined) return inline.groups.message;
  const captured = new RegExp('^(?<message>' + opening + '.*)$', 'mu').exec(document);
  if (captured?.groups?.message !== undefined) return captured.groups.message;
  throw new Error(
    `docs/request-paths.md no longer shows the refusal beginning "${opening}", ` +
      `quoted in a sentence or captured from the command that prints it.`,
  );
}

function statedDefault(name: string, variable: string): string {
  const pattern = new RegExp('`' + variable + '`[^`]*\\(default `(?<value>[0-9]+)`\\)', 'su');
  const stated = pattern.exec(textOf(name));
  if (stated?.groups?.value === undefined) {
    throw new Error(`${name} no longer states a default for ${variable}`);
  }
  return stated.groups.value;
}

describe('the retention schedule the documents describe is the one the server runs', () => {
  it.each(DOCUMENTS)('%s states the interval the config schema defaults to', (name) => {
    expect(statedDefault(name, 'ODUDU_REAP_INTERVAL_SECONDS')).toBe(
      String(defaults.ODUDU_REAP_INTERVAL_SECONDS),
    );
  });

  // Both documents describe the jitter as "a tenth" of the interval in
  // prose, which no regular expression over the fraction would catch.
  it('adds jitter of the fraction both documents call a tenth', () => {
    expect(REAP_JITTER_FRACTION).toBe(0.1);
    for (const name of DOCUMENTS) {
      expect(textOf(name)).toMatch(/a tenth of (?:that|the interval)/u);
    }
  });

  it('refuses without a serving connection in the words the document shows', () => {
    const command = readFileSync(path.join(REPO_ROOT, 'apps/server/src/cli/reap.ts'), 'utf8');
    const quoted = refusalQuoted(textOf('docs/request-paths.md'), 'reap requires ');
    expect(sourceText(command)).toContain(quoted.replaceAll(/\s+/gu, ' '));
  });

  it('logs the refusal docs/request-paths.md quotes, in those words', () => {
    const module = readFileSync(path.join(REPO_ROOT, 'apps/server/src/modules/reap.ts'), 'utf8');
    const quoted = /`(?<message>not reaping: [^`]+)`/su.exec(textOf('docs/request-paths.md'));
    if (quoted?.groups?.message === undefined) {
      throw new Error('docs/request-paths.md no longer quotes the refusal the schedule logs');
    }
    expect(module.replaceAll(/\s+/gu, ' ')).toContain(
      quoted.groups.message.replaceAll(/\s+/gu, ' '),
    );
  });
});

// The same three claims for the mail sender, which both documents describe
// the same way and for the same reason: a paragraph rewritten after a
// default moved reads exactly like one that is still true.
describe('the outbox schedule the documents describe is the one the server runs', () => {
  it.each(DOCUMENTS)('%s states the interval the config schema defaults to', (name) => {
    expect(statedDefault(name, 'ODUDU_OUTBOX_INTERVAL_SECONDS')).toBe(
      String(defaults.ODUDU_OUTBOX_INTERVAL_SECONDS),
    );
  });

  it('adds jitter of the fraction both documents call a tenth', () => {
    expect(OUTBOX_JITTER_FRACTION).toBe(0.1);
    for (const name of DOCUMENTS) {
      expect(textOf(name)).toMatch(/a tenth as jitter/u);
    }
  });

  it('states the attempt ceiling the config schema defaults to', () => {
    expect(statedDefault('docs/request-paths.md', 'ODUDU_OUTBOX_MAX_ATTEMPTS')).toBe(
      String(defaults.ODUDU_OUTBOX_MAX_ATTEMPTS),
    );
  });

  // The two windows an operator would actually act on, and the only
  // defaults either document gives in words rather than in digits — so a
  // regular expression over "(default `N`)" cannot reach them. The word is
  // read out of the sentence that names the variable and compared as
  // seconds.
  it.each([
    ['ODUDU_RETENTION_EMAIL_SENT_SECONDS', defaults.ODUDU_RETENTION_EMAIL_SENT_SECONDS],
    ['ODUDU_RETENTION_EMAIL_FAILED_SECONDS', defaults.ODUDU_RETENTION_EMAIL_FAILED_SECONDS],
  ])('describes %s as the period it defaults to', (variable, seconds) => {
    const words: Record<string, number> = { 'a week': 604_800, 'thirty days': 2_592_000 };
    const pattern = new RegExp('`' + variable + '`[^.]*?(?<period>a week|thirty days)', 'su');
    const stated = pattern.exec(textOf('docs/request-paths.md'));
    if (stated?.groups?.period === undefined) {
      throw new Error(`docs/request-paths.md no longer says how long ${variable} keeps a message`);
    }
    expect(words[stated.groups.period]).toBe(seconds);
  });

  it('refuses without a serving connection in the words the documents quote', () => {
    const command = readFileSync(path.join(REPO_ROOT, 'apps/server/src/cli/send-mail.ts'), 'utf8');
    const quoted = refusalQuoted(textOf('docs/request-paths.md'), 'odudu send-mail requires ');
    expect(sourceText(command)).toContain(quoted.replaceAll(/\s+/gu, ' '));
  });

  it('declines to schedule in the words README.md and request-paths.md quote', () => {
    const module = readFileSync(path.join(REPO_ROOT, 'apps/server/src/modules/outbox.ts'), 'utf8');
    const quoted = /`(?<message>not sending queued mail: [^`]+)`/su.exec(
      textOf('docs/request-paths.md'),
    );
    if (quoted?.groups?.message === undefined) {
      throw new Error('docs/request-paths.md no longer quotes the warning the schedule logs');
    }
    expect(module).toContain('ODUDU_OUTBOX_ENABLED=false');
    expect(sourceText(module)).toContain(quoted.groups.message.replaceAll(/\s+/gu, ' '));
  });
});

// The same interval and jitter claims, for the pass that delivers
// back-channel logouts — README-only. docs/request-paths.md now carries a
// real `odudu send-logouts` transcript (under "Front-channel and
// back-channel logout"), but states no interval or timeout default in
// words there for this check to read.
describe('the logout-sender schedule README describes is the one the server runs', () => {
  it('states the interval the config schema defaults to', () => {
    expect(statedDefault('README.md', 'ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS')).toBe(
      String(defaults.ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS),
    );
  });

  it('adds jitter of the fraction README calls a tenth', () => {
    expect(LOGOUT_SENDER_JITTER_FRACTION).toBe(0.1);
    expect(textOf('README.md')).toMatch(/a tenth as jitter/u);
  });

  it('states the response timeout the config schema defaults to', () => {
    expect(statedDefault('README.md', 'ODUDU_LOGOUT_SENDER_RESPONSE_TIMEOUT_MS')).toBe(
      String(defaults.ODUDU_LOGOUT_SENDER_RESPONSE_TIMEOUT_MS),
    );
  });
});
