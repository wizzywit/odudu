import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../docs/markdown.js';

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

// What the lockfile resolves under the @img scope. A package here that is
// neither MIT nor an Apache-2.0-only binding of sharp has to be named in the
// notices, so a new one fails until somebody has decided which it is.
const NOT_LGPL =
  /^(colour|sharp-(linux|linuxmusl|darwin)-[a-z0-9]+|sharp-(freebsd|webcontainers)-wasm32)$/u;

function imgPackages(): string[] {
  const names = new Set<string>();
  for (const match of read('pnpm-lock.yaml').matchAll(/^ {2}'@img\/([^@']+)@/gmu)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}

describe('third-party notices for the bundled libvips', () => {
  const notices = read('THIRD-PARTY-NOTICES.md');

  it('finds the @img packages in the lockfile', () => {
    expect(imgPackages().length).toBeGreaterThan(10);
  });

  it('names every @img package that carries LGPL code', () => {
    const missing = imgPackages()
      .filter((name) => !NOT_LGPL.test(name))
      .filter((name) => !notices.includes(`@img/${name}`));
    expect(missing).toEqual([]);
  });

  it('names the libvips and sharp-libvips versions and their release tags', () => {
    expect(notices).toContain('libvips/releases/tag/v8.18.7');
    expect(notices).toContain('sharp-libvips/releases/tag/v1.3.4');
  });

  it('points at licence texts that exist under LICENSES/', () => {
    const referenced = [...notices.matchAll(/\(LICENSES\/([^)]+)\)/gu)].map((m) => m[1] ?? '');
    expect(referenced).toEqual(
      expect.arrayContaining(['LGPL-3.0-or-later.txt', 'GPL-3.0-or-later.txt']),
    );
    const absent = referenced.filter((file) => !existsSync(path.join(REPO_ROOT, 'LICENSES', file)));
    expect(absent).toEqual([]);
  });

  it('copies the notices and the licence texts into the runtime image', () => {
    const dockerfile = read('infra/docker/Dockerfile');
    expect(dockerfile).toMatch(
      /^COPY .*THIRD-PARTY-NOTICES\.md .*\/usr\/share\/licenses\/odudu\/$/mu,
    );
    expect(dockerfile).toMatch(/^COPY .* LICENSES \/usr\/share\/licenses\/odudu\/LICENSES$/mu);
  });
});
