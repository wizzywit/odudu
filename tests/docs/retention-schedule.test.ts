import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../packages/kernel/src/config.js';
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

function statedInterval(name: string): string {
  const text = textOf(name);
  const stated = /`ODUDU_REAP_INTERVAL_SECONDS`[^`]*\(default `(?<value>[0-9]+)`\)/su.exec(text);
  if (stated?.groups?.value === undefined) {
    throw new Error(`${name} no longer states a default for ODUDU_REAP_INTERVAL_SECONDS`);
  }
  return stated.groups.value;
}

describe('the retention schedule the documents describe is the one the server runs', () => {
  it.each(DOCUMENTS)('%s states the interval the config schema defaults to', (name) => {
    expect(statedInterval(name)).toBe(String(defaults.ODUDU_REAP_INTERVAL_SECONDS));
  });

  // Both documents describe the jitter as "a tenth" of the interval in
  // prose, which no regular expression over the fraction would catch.
  it('adds jitter of the fraction both documents call a tenth', () => {
    expect(REAP_JITTER_FRACTION).toBe(0.1);
    for (const name of DOCUMENTS) {
      expect(textOf(name)).toMatch(/a tenth of (?:that|the interval)/u);
    }
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
