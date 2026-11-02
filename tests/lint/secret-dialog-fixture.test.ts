import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { REPO_ROOT } from '../docs/markdown.js';

// The console renders the secret dialog; the documentation's capture guard
// recognises it by the text nodes it renders. Each keeps a copy of those
// nodes, the console's held to its real render by its own test, so the copies
// must be one.
const read = (file: string): string => readFileSync(path.join(REPO_ROOT, file), 'utf8');

it('keeps the capture guard and the console agreed on what the secret dialog renders', () => {
  const console = read('apps/admin-console/src/shared/ui/SecretDialog/secretDialogNodes.json');
  const guard = read('apps/docs/scripts/console-shots/fixtures/secret-dialog.json');
  expect(JSON.parse(guard)).toEqual(JSON.parse(console));
});
