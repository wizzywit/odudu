import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const BUNDLE_PATH = path.join(REPO_ROOT, 'apps/server/dist/main.js');

// `@node-rs/argon2` ships a platform-specific native binary per OS/arch;
// bundling it (rather than leaving it as a runtime `require`) makes esbuild
// try to inline whichever binary happens to exist on the machine doing the
// build, which fails on every other platform. This is a build-then-inspect
// test, not a re-implementation of apps/server/tsup.config.ts's
// noExternal/external logic: it runs the real build and checks what tsup
// actually produced, so a config change that "successfully" builds but
// bundles argon2 anyway is still caught.
describe('the server bundle keeps @node-rs/argon2 external', () => {
  it('imports argon2 as a bare specifier and inlines no native binary', async () => {
    execFileSync('pnpm', ['--filter', '@odudu/server', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });

    const bundle = await readFile(BUNDLE_PATH, 'utf8');

    expect(bundle).toMatch(/from\s*["']@node-rs\/argon2["']/);
    expect(bundle).not.toMatch(/["'][^"']*\.node["']/);
  }, 60_000);
});
