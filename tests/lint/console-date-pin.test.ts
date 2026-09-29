import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The console builds React Aria's CalendarDate from @internationalized/date
// directly, so it must be the very copy React Aria resolves: a second copy
// would make every date field's value a stranger to the component.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

async function consolePin(): Promise<string | undefined> {
  const manifest: unknown = JSON.parse(
    await readFile(path.join(REPO_ROOT, 'apps/admin-console/package.json'), 'utf8'),
  );
  if (typeof manifest !== 'object' || manifest === null || !('devDependencies' in manifest)) {
    return undefined;
  }
  const dev: unknown = manifest.devDependencies;
  if (typeof dev !== 'object' || dev === null) return undefined;
  const pin: unknown = (dev as Record<string, unknown>)['@internationalized/date'];
  return typeof pin === 'string' ? pin : undefined;
}

// The version React Aria's own snapshot in the lockfile depends on.
export function reactAriasDate(lock: string): string | undefined {
  const snapshot =
    /^ {2}react-aria-components@[^\n]*\n {4}dependencies:\n((?: {6}[^\n]*\n)*)/mu.exec(lock);
  return /'@internationalized\/date': ([^\s]+)/u.exec(snapshot?.[1] ?? '')?.[1];
}

describe('the console’s date package', () => {
  it('is pinned to the version React Aria resolves', async () => {
    const lock = await readFile(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    const ours = await consolePin();
    expect(ours).toBeDefined();
    expect(ours).toBe(reactAriasDate(lock));
  });

  it('reads React Aria’s dependency out of a lockfile snapshot', () => {
    const lock = [
      '  react-aria-components@1.0.0(react@19.0.0):',
      '    dependencies:',
      "      '@internationalized/date': 3.9.9",
      '      react: 19.0.0',
      '',
    ].join('\n');
    expect(reactAriasDate(lock)).toBe('3.9.9');
  });
});
