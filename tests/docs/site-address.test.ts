import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './markdown.js';
import { siteConstants } from './site-constants.js';

// The site's address is written in apps/docs/site.config.ts. Everything the
// build derives from it is held by apps/docs/tests/seo-html.test.ts (canonical,
// Open Graph, sitemap) and seo-swap.test.ts (a build at another address names
// no trace of this one). This test holds the rest of the repository: a file
// that links to the site is on the list below, and no other file names it.
// Not seen: an address built from pieces, one in a binary file, and a link
// that names the host without the scheme.

const HOST = 'wizzywit.github.io';
const CONFIG = 'apps/docs/site.config.ts';

const MAY_LINK_TO_THE_SITE = new Set([
  'README.md',
  'CONTRIBUTING.md',
  'RELEASING.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  // A package's README is what its npm page shows, so its links cannot be relative.
  ...['admin-client', 'bff', 'me-client', 'next', 'node', 'oidc', 'react'].map(
    (name) => `sdks/${name}/README.md`,
  ),
  CONFIG,
]);

const RECORDS = /^(?:docs\/(?:archive|phases|superpowers)\/|CHANGELOG\.md$)|\.test\.ts$/u;

function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '' && !/\.(?:png|ico|woff2?|jpg|gif|webp)$/u.test(file));
}

function lines(file: string): { line: number; text: string }[] {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8')
    .split('\n')
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => text.includes(HOST));
}

describe('the site address', () => {
  it('is named in apps/docs/site.config.ts, and only linked to from the files that list it', () => {
    const stray = tracked()
      .filter((file) => !RECORDS.test(file) && !MAY_LINK_TO_THE_SITE.has(file))
      .flatMap((file) => lines(file).map(({ line }) => `${file}:${String(line)}`));
    expect(stray).toEqual([]);
  });

  it('is linked to in the listed files only under the config base, so one edit moves them together', async () => {
    const { PAGES_BASE } = await siteConstants();
    const off = [...MAY_LINK_TO_THE_SITE]
      .filter((file) => !['RELEASING.md', CONFIG].includes(file))
      .flatMap((file) =>
        lines(file)
          .filter(({ text }) => !text.includes(`${HOST}${PAGES_BASE}`))
          .map(({ line }) => `${file}:${String(line)}`),
      );
    expect(off).toEqual([]);
  });

  it('is named in no workflow', () => {
    const named = tracked()
      .filter((file) => file.startsWith('.github/workflows/'))
      .flatMap((file) => lines(file).map(({ line }) => `${file}:${String(line)}`));
    expect(named).toEqual([]);
  });

  it('is named in the config, which is what the other tests move', async () => {
    const { SITE_ORIGIN } = await siteConstants();
    expect(readFileSync(path.join(REPO_ROOT, CONFIG), 'utf8')).toContain(`'${SITE_ORIGIN}'`);
  });
});
