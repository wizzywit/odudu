import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A conversation bound to another tenant is never served at a path whose tenant
// differs. Every file that loads a stored conversation by id, in the assistant's
// usecases or in the admin API's assistant routes, must ask `conversationIsCallers`
// before it answers; one added later without it fails here, naming the file.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PATTERNS = [
  'packages/assistant/src/usecase/*.ts',
  'packages/protocol-admin/src/view/routes/assistant*.ts',
  'packages/protocol-admin/src/usecase/assistant*.ts',
];
const READS_ONE = /conversationRepository\([^)]*\)\.byId\(/u;

async function files(): Promise<string[]> {
  const found: string[] = [];
  for (const pattern of PATTERNS) {
    for await (const entry of glob(pattern, { cwd: REPO_ROOT })) {
      if (!entry.endsWith('.test.ts')) found.push(entry);
    }
  }
  return found;
}

describe('the conversation a path serves', () => {
  it('is checked against the path’s tenant wherever a stored conversation is read by id', async () => {
    const names = await files();
    expect(names.length).toBeGreaterThan(10);
    const missing: string[] = [];
    let readers = 0;
    for (const name of names) {
      const text = await readFile(path.join(REPO_ROOT, name), 'utf8');
      if (!READS_ONE.test(text)) continue;
      readers += 1;
      if (!text.includes('conversationIsCallers')) missing.push(name);
    }
    expect(readers).toBeGreaterThan(3);
    expect(missing, 'call conversationIsCallers on the record before answering').toEqual([]);
  });
});
